import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "./lib/api";

type FAQ = { q: string; a: string };

/* ─── Hooks ─── */

function useWindowScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    const handler = () => setY(window.scrollY || 0);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);
  return y;
}

function useReveal<T extends HTMLElement>(): React.RefCallback<T> {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbackRef = useCallback((el: T | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("visible");
          io.unobserve(el);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    observerRef.current = io;
  }, []);
  return callbackRef;
}

function useParallax(speed = 0.3): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const handler = () => setOffset(window.scrollY * speed);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [speed]);
  return offset;
}

/* ─── Particle Star Field (Canvas) ─── */

function StarField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    const stars: { x: number; y: number; r: number; vx: number; vy: number; alpha: number; pulse: number }[] = [];
    const STAR_COUNT = 120;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        alpha: Math.random() * 0.6 + 0.2,
        pulse: Math.random() * Math.PI * 2,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const t = Date.now() * 0.001;
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x = canvas!.width;
        if (s.x > canvas!.width) s.x = 0;
        if (s.y < 0) s.y = canvas!.height;
        if (s.y > canvas!.height) s.y = 0;

        const flicker = s.alpha + Math.sin(t * 1.5 + s.pulse) * 0.15;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(200, 220, 255, ${Math.max(0, flicker)})`;
        ctx!.fill();

        // Glow
        if (s.r > 1) {
          ctx!.beginPath();
          ctx!.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(0, 240, 255, ${flicker * 0.08})`;
          ctx!.fill();
        }
      }

      // Draw subtle connection lines between close stars
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x;
          const dy = stars[i].y - stars[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx!.beginPath();
            ctx!.moveTo(stars[i].x, stars[i].y);
            ctx!.lineTo(stars[j].x, stars[j].y);
            ctx!.strokeStyle = `rgba(0, 240, 255, ${0.03 * (1 - dist / 120)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity: 0.6 }}
    />
  );
}

/* ─── Animated Counter ─── */

function AnimatedCounter({ target, suffix = "", label }: { target: number; suffix?: string; label: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const hasAnimated = useRef(false);

  const callbackRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el || hasAnimated.current) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          io.unobserve(el);
          const duration = 2000;
          const startTime = performance.now();
          function animate(now: number) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(eased * target));
            if (progress < 1) requestAnimationFrame(animate);
          }
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
  }, [target]);

  return (
    <div ref={callbackRef} className="text-center">
      <div className="text-4xl font-bold md:text-5xl">
        <span className="bg-gradient-to-r from-[var(--cyan)] to-[var(--accent)] bg-clip-text text-transparent">
          {count.toLocaleString()}{suffix}
        </span>
      </div>
      <div className="mt-2 text-sm text-white/50">{label}</div>
    </div>
  );
}

/* ─── Typing Effect ─── */

function TypingText({ strings }: { strings: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = strings[currentIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && displayed.length < current.length) {
      timeout = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 60);
    } else if (!isDeleting && displayed.length === current.length) {
      timeout = setTimeout(() => setIsDeleting(true), 2000);
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 30);
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false);
      setCurrentIndex((prev) => (prev + 1) % strings.length);
    }

    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, currentIndex, strings]);

  return (
    <span className="typing-cursor font-mono text-[var(--cyan)]">{displayed}</span>
  );
}

/* ─── Mouse Spotlight ─── */

function useSpotlight(): React.RefCallback<HTMLElement> {
  const callbackRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    };
    el.addEventListener("mousemove", handler);
  }, []);
  return callbackRef;
}

/* ─── Utility Components ─── */

function Pill({ children, cyan }: { children: string; cyan?: boolean }) {
  const border = cyan ? "border-[var(--cyan)]/30" : "border-white/10";
  const bg = cyan ? "bg-[var(--cyan)]/5" : "bg-white/5";
  const text = cyan ? "text-[var(--cyan)]" : "text-white/80";
  return (
    <span className={`inline-flex items-center rounded-full border ${border} ${bg} px-3 py-1 text-xs font-medium ${text} backdrop-blur-sm`}>
      {children}
    </span>
  );
}

function GlowButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  if (variant === "secondary") {
    return (
      <a href={href} className="group relative inline-flex items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/5 px-7 py-4 text-sm font-semibold text-white/90 transition-all duration-300 hover:border-[var(--cyan)]/40 hover:bg-white/10 hover:shadow-[0_0_30px_rgba(0,240,255,0.1)]">
        {children}
      </a>
    );
  }
  return (
    <a href={href} className="group relative inline-flex items-center justify-center overflow-hidden rounded-xl bg-[var(--accent)] px-7 py-4 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(233,69,96,0.3)] transition-all duration-300 hover:shadow-[0_20px_60px_rgba(233,69,96,0.45)] hover:brightness-110">
      <span className="relative z-10">{children}</span>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
    </a>
  );
}

function SectionEyebrow({ text }: { text: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-[var(--cyan)]/20 bg-[var(--cyan)]/5 px-4 py-1.5 text-xs font-semibold tracking-widest uppercase text-[var(--cyan)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--cyan)] dot-pulse" />
      {text}
    </div>
  );
}

function ScreenshotShowcase({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal-scale tilt-hover ${className}`}>
      <div className="animated-border rounded-2xl">
        <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-white/8 to-white/3 p-1.5 shadow-[0_40px_120px_rgba(0,0,0,0.6)]">
          <div className="overflow-hidden rounded-[14px]">
            <img src={src} alt={alt} className="w-full h-auto transition-transform duration-700 hover:scale-[1.02]" loading="lazy" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, description, bullets, icon, delay = 0 }: { title: string; description: string; bullets: string[]; icon: React.ReactNode; delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  const spotlightRef = useSpotlight();
  return (
    <div
      ref={(el) => { ref(el); spotlightRef(el); }}
      className="reveal spotlight glow-border group rounded-2xl border border-white/8 bg-gradient-to-br from-white/6 to-white/2 p-6 transition-all duration-500 hover:border-white/15 hover:bg-white/8"
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="relative z-10">
        <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--cyan)]/20 bg-[var(--cyan)]/5 text-[var(--cyan)] transition-all duration-500 group-hover:shadow-[0_0_20px_rgba(0,240,255,0.2)]">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{description}</p>
        <ul className="mt-4 space-y-2.5 text-sm text-white/75">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent-glow)]" />
              <span className="text-pretty">{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StepCard({ step, title, description, children }: { step: string; title: string; description: string; children: React.ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal group relative">
      <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/6 to-white/2 p-6 transition-all duration-500 hover:border-[var(--cyan)]/20 hover:shadow-[0_0_40px_rgba(0,240,255,0.05)]">
        <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-xs font-bold text-[var(--accent)]">{step}</div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function PricingCard({
  name,
  price,
  subtitle,
  bullets,
  highlight = false,
}: {
  name: string;
  price: string;
  subtitle: string;
  bullets: string[];
  highlight?: boolean;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal rounded-2xl border p-6 transition-all duration-500 ${
        highlight
          ? "border-[var(--cyan)]/35 bg-gradient-to-br from-[var(--cyan)]/10 to-white/[0.04] shadow-[0_0_40px_rgba(0,240,255,0.08)]"
          : "border-white/10 bg-gradient-to-br from-white/6 to-white/2"
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-white">{name}</h3>
        {highlight && <Pill cyan>Most popular</Pill>}
      </div>
      <div className="mt-4 text-3xl font-bold text-white">{price}</div>
      <div className="mt-2 text-sm text-white/55">{subtitle}</div>
      <ul className="mt-5 space-y-2.5 text-sm text-white/80">
        {bullets.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-[var(--cyan)]/80" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Floating Decorative Elements ─── */

function FloatingShapes() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Hexagon */}
      <svg className="absolute left-[8%] top-[15%] float-slow opacity-[0.04]" width="60" height="60" viewBox="0 0 60 60">
        <polygon points="30,2 56,17 56,43 30,58 4,43 4,17" fill="none" stroke="var(--cyan)" strokeWidth="1" />
      </svg>
      {/* Circle */}
      <div className="absolute right-[12%] top-[25%] h-16 w-16 rounded-full border border-[var(--accent)]/10 float-medium opacity-60" />
      {/* Diamond */}
      <svg className="absolute left-[15%] bottom-[20%] float-rotate opacity-[0.03]" width="40" height="40" viewBox="0 0 40 40">
        <rect x="8" y="8" width="24" height="24" fill="none" stroke="var(--cyan)" strokeWidth="1" transform="rotate(45,20,20)" />
      </svg>
      {/* Small dots cluster */}
      <div className="absolute right-[20%] bottom-[30%] float-fast opacity-[0.06]">
        <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
        <div className="ml-3 mt-1 h-1.5 w-1.5 rounded-full bg-[var(--cyan)]" />
        <div className="ml-1 mt-2 h-1 w-1 rounded-full bg-white" />
      </div>
      {/* Triangle */}
      <svg className="absolute right-[5%] top-[60%] float-slow opacity-[0.03]" width="50" height="50" viewBox="0 0 50 50">
        <polygon points="25,5 45,45 5,45" fill="none" stroke="var(--accent)" strokeWidth="1" />
      </svg>
      {/* Cross */}
      <svg className="absolute left-[5%] top-[50%] float-medium opacity-[0.04]" width="30" height="30" viewBox="0 0 30 30">
        <line x1="15" y1="5" x2="15" y2="25" stroke="var(--cyan)" strokeWidth="1" />
        <line x1="5" y1="15" x2="25" y2="15" stroke="var(--cyan)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/* ─── Ticker Strip ─── */

function TechTicker() {
  const items = [
    "Claude Code", "OpenAI Codex", "3D Visualization", "Multi-Agent", "WebSocket Streaming",
    "Local-First", "React Three Fiber", "Terminal Sessions", "File Diffs", "Monaco Editor",
    "Claude Code", "OpenAI Codex", "3D Visualization", "Multi-Agent", "WebSocket Streaming",
    "Local-First", "React Three Fiber", "Terminal Sessions", "File Diffs", "Monaco Editor",
  ];
  return (
    <div className="relative overflow-hidden border-y border-white/5 bg-white/[0.02] py-4">
      <div className="ticker-track">
        {items.map((item, i) => (
          <span key={i} className="mx-8 whitespace-nowrap text-sm font-medium text-white/25">
            <span className="mr-3 inline-block h-1 w-1 rounded-full bg-[var(--cyan)]/40 align-middle" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Beam Divider ─── */

function BeamDivider() {
  return <div className="beam-divider mx-auto my-0 max-w-5xl" />;
}

/* ─── Icons (inline SVG) ─── */

const IconWorkspace = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
const IconChat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const IconCube = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

/* ─── Main Landing Page ─── */

export function LandingPage() {
  useEffect(() => {
    if (isTauri()) {
      window.location.replace("/app/");
    }
  }, []);

  const y = useWindowScrollY();
  const parallaxOffset = useParallax(0.15);
  const headerBg = y > 10
    ? "bg-black/60 backdrop-blur-2xl border-b border-white/8 shadow-[0_4px_30px_rgba(0,0,0,0.4)]"
    : "bg-transparent";

  const heroRef = useReveal<HTMLDivElement>();
  const heroImageRef = useReveal<HTMLDivElement>();
  const statsRef = useReveal<HTMLDivElement>();

  const faqs: FAQ[] = useMemo(
    () => [
      { q: "Is Virtual Agency \"local-first\"?", a: "Yes. The web UI connects to a small local server running on your machine (127.0.0.1). That server spawns terminals and agent CLIs and keeps workspace actions on-device." },
      { q: "How does pricing work?", a: "You can start on Local Only at $10/month, then move to Cloud + Local tiers at $25, $50, or $75/month with increasing server capacity (vCPU and RAM)." },
      { q: "Which models do you support?", a: "Virtual Agency can run agents via supported CLIs (Codex and Claude). You pick the backend per agent and see their status and activity in real time." },
      { q: "Can I run multiple agents at once?", a: "That\u2019s the core workflow. Each agent gets its own working directory, chat, terminal sessions, and file edits \u2014 like a small team." },
      { q: "Is this a replacement for my IDE?", a: "No \u2014 it\u2019s a command center. You can inspect file changes, open and edit files, and run terminals, but it\u2019s designed around managing agent work rather than replacing VS Code." },
    ],
    []
  );

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const toggleFaq = useCallback((i: number) => setOpenFaq((prev) => (prev === i ? null : i)), []);

  return (
    <div className="noise-overlay relative min-h-screen overflow-x-hidden bg-[#040408] text-white">
      {/* ─── Animated star field ─── */}
      <StarField />

      {/* ─── Ambient background orbs ─── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="grid-bg absolute inset-0 opacity-30" />
        <div className="hero-orb h-[900px] w-[900px] bg-[var(--accent)] opacity-[0.06] left-[-250px] top-[-250px]" style={{ transform: `translateY(${parallaxOffset * 0.5}px)` }} />
        <div className="hero-orb h-[700px] w-[700px] bg-[var(--cyan)] opacity-[0.04] right-[-200px] top-[15%]" style={{ transform: `translateY(${parallaxOffset * 0.8}px)` }} />
        <div className="hero-orb h-[600px] w-[600px] bg-[#7c3aed] opacity-[0.035] left-[25%] top-[55%]" style={{ transform: `translateY(${parallaxOffset * -0.3}px)` }} />
        <div className="hero-orb h-[400px] w-[400px] bg-[var(--cyan)] opacity-[0.03] right-[10%] top-[70%]" style={{ transform: `translateY(${parallaxOffset * 0.4}px)` }} />
      </div>

      {/* ─── Floating decorative shapes ─── */}
      <FloatingShapes />

      {/* ─── Header ─── */}
      <header className={`sticky top-0 z-50 transition-all duration-500 ${headerBg}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="/" className="flex items-center gap-3 group">
            <img src="/logo.svg" alt="Virtual Agency" className="h-8 w-8 transition-transform duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_var(--accent-glow)]" />
            <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
              Virtual Agency
            </span>
          </a>
          <nav className="hidden items-center gap-8 text-sm text-white/60 md:flex">
            {["features", "pricing", "roblox", "how", "showcase", "faq"].map((id) => (
              <a key={id} className="relative transition-colors hover:text-[var(--cyan)] after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-[var(--cyan)] after:transition-all hover:after:w-full" href={`#${id}`}>
                {id === "how" ? "How it works" : id === "roblox" ? "Roblox Agent" : id === "pricing" ? "Pricing" : id.charAt(0).toUpperCase() + id.slice(1)}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="/app/" className="hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 transition-all hover:border-[var(--cyan)]/30 hover:bg-white/10 hover:text-white sm:inline-flex">
              Open App
            </a>
            <a href="/app/" className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(233,69,96,0.3)] transition-all hover:shadow-[0_15px_40px_rgba(233,69,96,0.45)] hover:brightness-110">
              Get started
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ═══════════ HERO ═══════════ */}
        <section className="relative overflow-hidden pt-20 pb-8 sm:pt-32 sm:pb-12">
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.03]">
            <div className="absolute inset-x-0 h-[2px] bg-[var(--cyan)]" style={{ animation: "scanline 8s linear infinite" }} />
          </div>

          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div ref={heroRef} className="reveal mx-auto max-w-4xl text-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Pill cyan>Local-first</Pill>
                <Pill cyan>Multi-agent</Pill>
                <Pill cyan>Chat &bull; Terminal &bull; Files</Pill>
                <Pill cyan>3D Office</Pill>
              </div>

              <h1 className="mt-8 text-balance text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-8xl" style={{ animation: "heroGlow 4s ease-in-out infinite" }}>
                Run AI agents{" "}
                <span className="bg-gradient-to-r from-[var(--accent)] via-[#ff6b9d] to-[var(--cyan)] bg-clip-text text-transparent bg-[length:200%_auto]" style={{ animation: "gradientShift 3s ease-in-out infinite" }}>
                  like a real team.
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-white/50 md:text-xl">
                A command center for{" "}
                <TypingText strings={["Codex agents", "Claude agents", "autonomous teams", "parallel workflows"]} />
                <br className="hidden sm:block" />
                <span className="text-white/40">Give each agent a workspace, watch them work in a 3D office, and jump in anytime.</span>
              </p>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-center">
                <GlowButton href="/app/">Launch the App</GlowButton>
                <GlowButton href="#install" variant="secondary">Install the Server</GlowButton>
              </div>

              <p className="mt-5 text-xs text-white/30">
                Tip: If you already have the local server running, you can jump straight into the app.
              </p>
            </div>

            {/* ─── Hero Screenshot with animated border ─── */}
            <div ref={heroImageRef} className="reveal-scale mx-auto mt-20 max-w-6xl perspective-section">
              <div className="perspective-child animated-border rounded-2xl">
                <div className="relative rounded-2xl border border-white/5 bg-gradient-to-b from-white/8 to-white/3 p-1.5 shadow-[0_60px_160px_rgba(0,0,0,0.8)]">
                  <div className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden opacity-[0.04]">
                    <div className="absolute inset-x-0 h-[1px] bg-[var(--cyan)]" style={{ animation: "scanline 6s linear infinite" }} />
                  </div>
                  <div className="overflow-hidden rounded-[14px]">
                    <img src="/screenshot1.png" alt="Virtual Agency — 3D office with AI agents and split-view code editor" className="w-full h-auto" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ ROBLOX AGENT ═══════════ */}
        <section id="roblox" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-40 top-0 h-80 w-80 rounded-full bg-[var(--cyan)] opacity-[0.06] blur-[120px]" />
            <div className="absolute -right-40 bottom-0 h-80 w-80 rounded-full bg-[var(--accent)] opacity-[0.06] blur-[120px]" />
          </div>

          <div className="relative z-10 grid grid-cols-1 items-center gap-10 md:grid-cols-2">
            <div className="reveal" ref={useReveal<HTMLDivElement>()}>
              <SectionEyebrow text="Specialized Agent" />
              <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
                Ship faster in{" "}
                <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--cyan)] bg-clip-text text-transparent">
                  Roblox Studio
                </span>
              </h2>
              <p className="mt-4 text-pretty text-base text-white/50 md:text-lg">
                Meet the Roblox Builder Agent — a purpose-built teammate that understands Rojo workflows, Luau, and Studio iteration.
                It keeps your project moving while you stay in control.
              </p>

              <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">Rojo-aware workflow</div>
                  <div className="mt-1 text-sm text-white/50">
                    Works with Rojo + file sync patterns and avoids risky “downgrades” unless you confirm.
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">Build systems, not snippets</div>
                  <div className="mt-1 text-sm text-white/50">
                    Generates clean Luau structure, modules, and conventions that scale with your game.
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">Hands-on debugging</div>
                  <div className="mt-1 text-sm text-white/50">
                    Reads logs, reproduces steps, and proposes fixes you can review before applying.
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">Designed for iteration</div>
                  <div className="mt-1 text-sm text-white/50">
                    Keeps the feedback loop tight: chat → terminal → diffs → ship.
                  </div>
                </div>
              </div>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <GlowButton href="/app/">Try the Roblox Agent</GlowButton>
                <GlowButton href="#install" variant="secondary">
                  Install the Local Server
                </GlowButton>
              </div>

              <p className="mt-5 text-xs text-white/30">
                Pro tip: Run the local server first, then open <span className="text-white/50">virtualagency.ai/app/</span>.
              </p>
            </div>

            <div className="reveal-scale" ref={useReveal<HTMLDivElement>()}>
              <div className="animated-border rounded-2xl">
                <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-white/8 to-white/3 p-2 shadow-[0_60px_160px_rgba(0,0,0,0.8)]">
                  <div className="overflow-hidden rounded-[14px]">
                    <video
                      src="/roblox.mp4"
                      controls
                      playsInline
                      preload="metadata"
                      poster="/screenshot-overview.png"
                      className="h-auto w-full bg-black"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <div className="text-xs text-white/40">Roblox Builder Agent demo</div>
                    <div className="text-xs text-white/30">Watch the flow end-to-end</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Tech Ticker Strip ─── */}
        <TechTicker />

        {/* ─── Animated Number Stats ─── */}
        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
          <div ref={statsRef} className="stagger-children grid grid-cols-1 gap-8 sm:grid-cols-3">
            <AnimatedCounter target={50} suffix="+" label="Concurrent agents supported" />
            <AnimatedCounter target={100} suffix="%" label="Local — nothing leaves your machine" />
            <AnimatedCounter target={3} suffix="D" label="Interactive office visualization" />
          </div>
        </section>

        <BeamDivider />

        {/* ═══════════ FEATURES ═══════════ */}
        <section id="features" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <FloatingShapes />
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <SectionEyebrow text="Features" />
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
              Everything you need to supervise{" "}
              <span className="bg-gradient-to-r from-[var(--cyan)] to-[#7c3aed] bg-clip-text text-transparent">autonomous work</span>
            </h2>
            <p className="mt-4 text-pretty text-base text-white/50 md:text-lg">
              Built for speed: short feedback loops, clear state, and minimal friction to intervene.
            </p>
          </div>

          <div className="relative z-10 mt-14 grid grid-cols-1 gap-6 md:grid-cols-2">
            <FeatureCard icon={<IconWorkspace />} title="Agent workspaces" description="Each agent is a self-contained unit with its own working directory, history, and capabilities." bullets={["Pick a backend (Codex or Claude) per agent", "Clear status: idle / thinking / working / error", "Designed for running many agents in parallel"]} delay={0} />
            <FeatureCard icon={<IconChat />} title="Chat + terminal + files" description="A tight loop between instruction, execution, and review." bullets={["Chat with tool output and attachments", "Spawn terminals per agent (and keep output buffered)", "Inspect diffs before you accept file writes"]} delay={100} />
            <FeatureCard icon={<IconCube />} title="3D office visualization" description="See the system at a glance: who's at a desk, who's in the lobby, and what's active." bullets={["Smooth camera controls with performance optimizations", "Click agents to open their panel without losing context", "Workstations and lounge behaviors convey state instantly"]} delay={200} />
            <FeatureCard icon={<IconShield />} title="Local-first architecture" description="The web UI connects to a local server that actually runs the CLIs and terminals." bullets={["Runs on 127.0.0.1 (private by default)", "Responsive IO streaming over WebSocket", "Keeps your workspace local while UI stays lightweight"]} delay={300} />
          </div>
        </section>

        <BeamDivider />

        {/* ═══════════ SHOWCASE ═══════════ */}
        <section id="showcase" className="relative py-20 sm:py-28">
          <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-[var(--accent)] opacity-[0.04] blur-[150px]" />

          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <SectionEyebrow text="Showcase" />
              <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
                See it{" "}
                <span className="bg-gradient-to-r from-[var(--accent)] to-[#ff6b9d] bg-clip-text text-transparent">in action</span>
              </h2>
              <p className="mt-4 text-base text-white/50 md:text-lg">
                Real screenshots from the app. Every agent gets a desk, a terminal, and a chat.
              </p>
            </div>

            <div className="mt-16 space-y-24">
              {/* Row 1 */}
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
                <div>
                  <ScreenshotShowcase src="/screenshot5.png" alt="3D office environment with multiple agents at their desks" />
                </div>
                <div className="reveal" ref={useReveal<HTMLDivElement>()}>
                  <Pill cyan>3D Office</Pill>
                  <h3 className="mt-4 text-2xl font-bold text-white md:text-3xl">Your agents, visualized</h3>
                  <p className="mt-3 text-base leading-relaxed text-white/50">
                    Watch your AI team work in a real-time 3D office. Each agent walks to their desk when active,
                    hangs in the lounge when idle, and shows status at a glance. Click any agent to open their panel instantly.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Pill>Camera controls</Pill>
                    <Pill>Status indicators</Pill>
                    <Pill>Click to inspect</Pill>
                  </div>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
                <div className="reveal order-2 md:order-1" ref={useReveal<HTMLDivElement>()}>
                  <Pill cyan>Agent Configuration</Pill>
                  <h3 className="mt-4 text-2xl font-bold text-white md:text-3xl">Spin up agents in seconds</h3>
                  <p className="mt-3 text-base leading-relaxed text-white/50">
                    Configure each agent with a working directory, CLI backend, model selection, and custom avatar.
                    Choose between Claude or Codex, pick your model tier, and toggle extended thinking for complex tasks.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Pill>Claude &amp; Codex</Pill>
                    <Pill>Model selection</Pill>
                    <Pill>Custom avatars</Pill>
                  </div>
                </div>
                <div className="order-1 md:order-2">
                  <ScreenshotShowcase src="/screenshot2.png" alt="Agent creation modal with model and avatar selection" />
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
                <div>
                  <ScreenshotShowcase src="/screenshot3.png" alt="Split view showing 3D office and terminal sessions" />
                </div>
                <div className="reveal" ref={useReveal<HTMLDivElement>()}>
                  <Pill cyan>Terminal Sessions</Pill>
                  <h3 className="mt-4 text-2xl font-bold text-white md:text-3xl">Full terminal access per agent</h3>
                  <p className="mt-3 text-base leading-relaxed text-white/50">
                    Spawn dedicated terminal sessions for each agent. Output stays buffered, so you never lose context.
                    Run builds, tests, or any command — the 3D office updates in real time alongside.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Pill>Buffered output</Pill>
                    <Pill>Multi-terminal</Pill>
                    <Pill>Real-time sync</Pill>
                  </div>
                </div>
              </div>

              {/* Row 4 */}
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
                <div className="reveal order-2 md:order-1" ref={useReveal<HTMLDivElement>()}>
                  <Pill cyan>File Explorer</Pill>
                  <h3 className="mt-4 text-2xl font-bold text-white md:text-3xl">Inspect every change</h3>
                  <p className="mt-3 text-base leading-relaxed text-white/50">
                    Browse your project's file tree, open files in a built-in editor, and review diffs before accepting any write.
                    You stay in control while agents do the heavy lifting.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Pill>File tree</Pill>
                    <Pill>Built-in editor</Pill>
                    <Pill>Diff review</Pill>
                  </div>
                </div>
                <div className="order-1 md:order-2">
                  <ScreenshotShowcase src="/screenshot4.png" alt="File explorer with code editor and project structure" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <BeamDivider />

        {/* ═══════════ HOW IT WORKS ═══════════ */}
        <section id="how" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <SectionEyebrow text="How it works" />
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
              A simple setup that{" "}
              <span className="bg-gradient-to-r from-[var(--cyan)] to-[#60a5fa] bg-clip-text text-transparent">scales</span>
            </h2>
            <p className="mt-4 text-base text-white/50 md:text-lg">
              Install the local server once, then use the browser UI anywhere on the same machine.
            </p>
          </div>

          {/* Connecting dots line (desktop) */}
          <div className="hidden md:flex absolute left-1/2 top-[290px] w-[55%] -translate-x-1/2 items-center justify-between">
            <div className="h-2 w-2 rounded-full bg-[var(--cyan)]/30 dot-pulse" />
            <div className="flex-1 h-[1px] bg-gradient-to-r from-[var(--cyan)]/20 via-[var(--cyan)]/10 to-[var(--cyan)]/20" />
            <div className="h-2 w-2 rounded-full bg-[var(--cyan)]/30 dot-pulse" style={{ animationDelay: "0.3s" }} />
            <div className="flex-1 h-[1px] bg-gradient-to-r from-[var(--cyan)]/20 via-[var(--cyan)]/10 to-[var(--cyan)]/20" />
            <div className="h-2 w-2 rounded-full bg-[var(--cyan)]/30 dot-pulse" style={{ animationDelay: "0.6s" }} />
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            <StepCard step="1" title="Run the local server" description="Start the Virtual Agency server on your machine to enable terminals and agent backends.">
              <div className="rounded-lg border border-[var(--cyan)]/10 bg-black/40 p-3 font-mono text-xs text-[var(--cyan)]/80">
                <span className="text-white/30">$ </span>virtual-agency-server --port 1337
                <br />
                <span className="text-white/30">{"\u2192"} </span>http://127.0.0.1:1337
              </div>
            </StepCard>
            <StepCard step="2" title="Open the app" description="Launch the web UI and create an agent per task or per repository.">
              <div className="rounded-lg border border-[var(--accent)]/10 bg-black/40 p-3 font-mono text-xs text-[var(--accent)]/80">virtualagency.ai/app/</div>
            </StepCard>
            <StepCard step="3" title="Review and ship" description="Watch progress, inspect diffs, and stop or redirect work when needed.">
              <div className="flex flex-wrap gap-2">
                <Pill>Diff review</Pill>
                <Pill>Terminal</Pill>
                <Pill>Agent status</Pill>
              </div>
            </StepCard>
          </div>
        </section>

        <BeamDivider />

        {/* ═══════════ PRICING ═══════════ */}
        <section id="pricing" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <SectionEyebrow text="Pricing" />
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
              Pick the plan that fits your runtime
            </h2>
            <p className="mt-4 text-base text-white/50 md:text-lg">
              Start local, then add managed cloud capacity when you need always-on agents.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <PricingCard
              name="Local Only"
              price="$10/mo"
              subtitle="Everything runs on your machine."
              bullets={[
                "Local server + web app access",
                "Local terminals, chat, file diffs",
                "No managed cloud server included",
              ]}
            />
            <PricingCard
              name="Cloud + Local Starter"
              price="$25/mo"
              subtitle="Includes managed cloud capacity."
              bullets={[
                "Cloud Agents + Local Agents",
                "2 vCPU • 2GB RAM",
                "Best for lighter workloads",
              ]}
              highlight
            />
            <PricingCard
              name="Cloud + Local Pro"
              price="$50/mo"
              subtitle="More cloud capacity for heavier tasks."
              bullets={[
                "Cloud Agents + Local Agents",
                "3 vCPU • 4GB RAM",
                "Better for sustained multi-agent runs",
              ]}
            />
            <PricingCard
              name="Cloud + Local Max"
              price="$75/mo"
              subtitle="Highest managed cloud capacity."
              bullets={[
                "Cloud Agents + Local Agents",
                "4 vCPU • 8GB RAM",
                "For demanding, always-on workloads",
              ]}
            />
          </div>

          <div className="mt-10 text-center text-xs text-white/35">
            Existing users on higher legacy cloud capacity keep their current allocation.
          </div>
        </section>

        <BeamDivider />

        {/* ═══════════ INSTALL ═══════════ */}
        <section id="install" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="reveal-scale relative overflow-hidden rounded-3xl" ref={useReveal<HTMLDivElement>()}>
            <div className="animated-border rounded-3xl">
              <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-white/6 to-white/2">
                <div className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full bg-[var(--accent)] opacity-[0.08] blur-[100px]" />
                <div className="pointer-events-none absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-[var(--cyan)] opacity-[0.06] blur-[100px]" />
                <div className="relative p-8 md:p-12">
                  <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
                    <div>
                      <SectionEyebrow text="Install" />
                      <h3 className="mt-4 text-2xl font-bold text-white md:text-3xl">Install the local server</h3>
                      <p className="mt-3 text-base leading-relaxed text-white/50">
                        The local server runs terminals and agent backends on your machine. Install once, run it, then keep it open while you use the web app.
                      </p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <Pill cyan>npm install -g</Pill>
                        <Pill cyan>macOS / Windows / Linux</Pill>
                        <Pill cyan>Local-only by default</Pill>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-[var(--cyan)]/80">
                        <span className="text-white/30">$ </span>npm install -g @virtualagency/server
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-[var(--cyan)]/80">
                        <span className="text-white/30">$ </span>virtual-agency-server --port 1337
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-white/60">
                        Optional: <span className="text-[var(--cyan)]">npx @virtualagency/server --port 1337</span>
                      </div>
                      <a href="/app/" className="sm:col-span-2 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(233,69,96,0.3)] transition-all duration-300 hover:shadow-[0_20px_60px_rgba(233,69,96,0.45)] hover:brightness-110">
                        Open the App
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ FAQ ═══════════ */}
        <section id="faq" className="mx-auto max-w-7xl px-5 pb-28 sm:px-8 sm:pb-36">
          <div className="mx-auto max-w-3xl text-center">
            <SectionEyebrow text="FAQ" />
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
              Questions,{" "}
              <span className="bg-gradient-to-r from-white/90 to-white/50 bg-clip-text text-transparent">answered</span>
            </h2>
            <p className="mt-4 text-base text-white/50 md:text-lg">
              If you're evaluating Virtual Agency, here are the details that matter.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-4">
            {faqs.map((f, i) => {
              const isOpen = openFaq === i;
              return (
                <div
                  key={f.q}
                  className={`rounded-2xl border transition-all duration-500 ${isOpen ? "border-[var(--cyan)]/20 bg-white/6 shadow-[0_0_40px_rgba(0,240,255,0.04)]" : "border-white/8 bg-white/3 hover:border-white/15"}`}
                >
                  <button onClick={() => toggleFaq(i)} className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left">
                    <span className="text-sm font-semibold text-white">{f.q}</span>
                    <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-xs transition-all duration-300 ${isOpen ? "border-[var(--cyan)]/30 bg-[var(--cyan)]/10 text-[var(--cyan)] rotate-45" : "border-white/15 bg-white/5 text-white/50"}`}>+</span>
                  </button>
                  <div className={`grid transition-all duration-500 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="overflow-hidden">
                      <p className="px-5 pb-5 text-sm leading-relaxed text-white/60">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ═══════════ CTA ═══════════ */}
        <section className="relative mx-auto max-w-7xl px-5 pb-28 sm:px-8 sm:pb-36">
          <div className="reveal relative overflow-hidden rounded-3xl text-center" ref={useReveal<HTMLDivElement>()}>
            <div className="animated-border rounded-3xl">
              <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-[var(--accent)]/8 to-[var(--cyan)]/5">
                <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
                <div className="relative p-14 md:p-24">
                  <h2 className="text-3xl font-bold tracking-tight text-white md:text-6xl" style={{ animation: "heroGlow 4s ease-in-out infinite" }}>
                    Ready to build with your AI team?
                  </h2>
                  <p className="mx-auto mt-5 max-w-xl text-base text-white/45 md:text-lg">
                    Install the server, launch the app, and start shipping with autonomous agents today.
                  </p>
                  <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-center">
                    <GlowButton href="/app/">Launch the App</GlowButton>
                    <GlowButton href="#install" variant="secondary">Install the Server</GlowButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-white/6 bg-black/30">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-10 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="h-6 w-6 opacity-60" />
            <span>&copy; {new Date().getFullYear()} Virtual Agency</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a className="transition-colors hover:text-[var(--cyan)]" href="/app/">Open App</a>
            <a className="transition-colors hover:text-[var(--cyan)]" href="#install">Install</a>
            <a className="transition-colors hover:text-[var(--cyan)]" href="/terms/">Terms</a>
            <a className="transition-colors hover:text-[var(--cyan)]" href="/privacy/">Privacy</a>
            <a className="transition-colors hover:text-[var(--cyan)]" href="mailto:hello@virtualagency.ai">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
