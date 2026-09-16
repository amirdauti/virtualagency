//! Serialize media preparation and model admission per agent. Stop/cancellation
//! deliberately bypasses this queue; the handler still checks its generation.
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

type Handler<T> = dyn Fn(T) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync;

struct Worker<T> {
    sender: mpsc::UnboundedSender<T>,
    task: JoinHandle<()>,
}

struct Registry<T> {
    closed: bool,
    workers: HashMap<String, Worker<T>>,
}

struct Inner<T> {
    registry: Mutex<Registry<T>>,
    handler: Arc<Handler<T>>,
}

/// Call `enqueue` in admission order, before spawning any media preprocessing.
/// The entire handler future runs serially for an agent; other agents do not wait.
pub struct Dispatcher<T> {
    inner: Arc<Inner<T>>,
}

impl<T> Clone for Dispatcher<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl<T: Send + 'static> Dispatcher<T> {
    pub fn new<F, Fut>(handler: F) -> Self
    where
        F: Fn(T) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        Self {
            inner: Arc::new(Inner {
                registry: Mutex::new(Registry {
                    closed: false,
                    workers: HashMap::new(),
                }),
                handler: Arc::new(move |item| Box::pin(handler(item))),
            }),
        }
    }

    /// Returns the unaccepted item after explicit shutdown (or a poisoned lock).
    /// A closed worker is replaced before accepting the next item. Already
    /// accepted work is never automatically replayed after a worker failure.
    pub fn enqueue(&self, agent_id: &str, mut item: T) -> Result<(), T> {
        let mut registry = match self.inner.registry.lock() {
            Ok(registry) => registry,
            Err(_) => return Err(item),
        };
        if registry.closed {
            return Err(item);
        }
        if let Some(worker) = registry.workers.get(agent_id) {
            match worker.sender.send(item) {
                Ok(()) => return Ok(()),
                Err(error) => item = error.0,
            }
        }
        if let Some(worker) = registry.workers.remove(agent_id) {
            worker.task.abort();
        }
        let (sender, mut receiver) = mpsc::unbounded_channel();
        // Queue before spawn: the first admitted item stays ahead of concurrent
        // enqueues, which cannot acquire the registry until the worker is saved.
        if let Err(error) = sender.send(item) {
            return Err(error.0);
        }
        let handler = self.inner.handler.clone();
        let task = tokio::spawn(async move {
            while let Some(item) = receiver.recv().await {
                handler(item).await;
            }
        });
        registry
            .workers
            .insert(agent_id.to_string(), Worker { sender, task });
        Ok(())
    }

    /// Remove a deleted agent and cancel its active handler at the next yield.
    /// Ordinary Stop should instead invalidate the handler's generation, so new
    /// messages retain their place and old preparation can finish/cancel safely.
    pub fn remove(&self, agent_id: &str) {
        if let Ok(mut registry) = self.inner.registry.lock() {
            if let Some(worker) = registry.workers.remove(agent_id) {
                worker.task.abort();
            }
        }
    }

    /// Stop all workers and reject subsequent enqueue attempts.
    pub fn close(&self) {
        if let Ok(mut registry) = self.inner.registry.lock() {
            registry.closed = true;
            for (_, worker) in registry.workers.drain() {
                worker.task.abort();
            }
        }
    }
}

impl<T> Drop for Inner<T> {
    fn drop(&mut self) {
        if let Ok(registry) = self.registry.get_mut() {
            for (_, worker) in registry.workers.drain() {
                worker.task.abort();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::sync::{oneshot, Semaphore};

    async fn next(receiver: &mut mpsc::UnboundedReceiver<&'static str>) -> &'static str {
        tokio::time::timeout(Duration::from_secs(2), receiver.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn slow_first_media_cannot_be_overtaken_by_later_text() {
        let gate = Arc::new(Semaphore::new(0));
        let (events, mut received) = mpsc::unbounded_channel();
        let handler_gate = gate.clone();
        let queue = Dispatcher::new(move |item: &'static str| {
            let gate = handler_gate.clone();
            let events = events.clone();
            async move {
                if item == "photo" {
                    events.send("preparing photo").unwrap();
                    gate.acquire().await.unwrap().forget();
                }
                events.send(item).unwrap();
            }
        });
        queue.enqueue("agent-1", "photo").unwrap();
        assert_eq!(next(&mut received).await, "preparing photo");
        queue.enqueue("agent-1", "text").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(30), received.recv())
                .await
                .is_err()
        );
        gate.add_permits(1);
        assert_eq!(next(&mut received).await, "photo");
        assert_eq!(next(&mut received).await, "text");
    }

    #[tokio::test]
    async fn an_independent_agent_does_not_wait_for_slow_preprocessing() {
        let gate = Arc::new(Semaphore::new(0));
        let (events, mut received) = mpsc::unbounded_channel();
        let handler_gate = gate.clone();
        let queue = Dispatcher::new(move |item: &'static str| {
            let gate = handler_gate.clone();
            let events = events.clone();
            async move {
                if item == "slow" {
                    events.send("started slow").unwrap();
                    gate.acquire().await.unwrap().forget();
                }
                events.send(item).unwrap();
            }
        });
        queue.enqueue("agent-1", "slow").unwrap();
        assert_eq!(next(&mut received).await, "started slow");
        queue.enqueue("agent-2", "independent").unwrap();
        assert_eq!(next(&mut received).await, "independent");
        gate.add_permits(1);
        assert_eq!(next(&mut received).await, "slow");
    }

    #[tokio::test]
    async fn removed_agent_drops_pending_work_and_can_be_registered_again() {
        let (events, mut received) = mpsc::unbounded_channel();
        let queue = Dispatcher::new(move |item: &'static str| {
            let events = events.clone();
            async move {
                events.send(item).unwrap();
                if item == "old active" {
                    std::future::pending::<()>().await;
                }
            }
        });
        queue.enqueue("agent-1", "old active").unwrap();
        assert_eq!(next(&mut received).await, "old active");
        queue.enqueue("agent-1", "old pending").unwrap();
        queue.remove("agent-1");
        queue.enqueue("agent-1", "replacement").unwrap();
        assert_eq!(next(&mut received).await, "replacement");
        queue.close();
        assert_eq!(queue.enqueue("agent-1", "rejected"), Err("rejected"));
    }

    #[tokio::test]
    async fn a_closed_worker_is_replaced_without_replaying_previous_input() {
        let (events, mut received) = mpsc::unbounded_channel();
        let queue = Dispatcher::new(move |item: &'static str| {
            let events = events.clone();
            async move {
                events.send(item).unwrap();
            }
        });
        queue.enqueue("agent-1", "first").unwrap();
        assert_eq!(next(&mut received).await, "first");
        let abort = queue.inner.registry.lock().unwrap().workers["agent-1"]
            .task
            .abort_handle();
        abort.abort();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !queue.inner.registry.lock().unwrap().workers["agent-1"]
                .sender
                .is_closed()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        queue.enqueue("agent-1", "second").unwrap();
        assert_eq!(next(&mut received).await, "second");
        assert!(received.try_recv().is_err());
    }

    #[tokio::test]
    async fn dropping_last_dispatcher_cancels_workers_but_dropping_clone_does_not() {
        struct Dropped(Option<oneshot::Sender<()>>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                if let Some(sender) = self.0.take() {
                    let _ = sender.send(());
                }
            }
        }
        let (done, dropped) = oneshot::channel();
        let done = Arc::new(Mutex::new(Some(done)));
        let (started, mut received) = mpsc::unbounded_channel();
        let queue = Dispatcher::new(move |_: ()| {
            let guard = Dropped(done.lock().unwrap().take());
            let started = started.clone();
            async move {
                let _guard = guard;
                started.send("started").unwrap();
                std::future::pending::<()>().await;
            }
        });
        queue.enqueue("agent-1", ()).unwrap();
        assert_eq!(next(&mut received).await, "started");
        drop(queue.clone());
        assert!(!queue.inner.registry.lock().unwrap().workers["agent-1"]
            .task
            .is_finished());
        drop(queue);
        tokio::time::timeout(Duration::from_secs(2), dropped)
            .await
            .unwrap()
            .unwrap();
    }
}
