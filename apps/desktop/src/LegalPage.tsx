type LegalPageKind = "terms" | "privacy";

interface LegalPageProps {
  kind: LegalPageKind;
}

interface LegalSection {
  title: string;
  body: string[];
}

const EFFECTIVE_DATE = "February 24, 2026";
const CONTACT_EMAIL = "hello@virtualagency.ai";

const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "Acceptance",
    body: [
      "By accessing or using Virtual Agency, you agree to these Terms of Service and our Privacy Policy.",
      "If you do not agree, do not use the service.",
    ],
  },
  {
    title: "Service Description",
    body: [
      "Virtual Agency provides tooling to create and manage AI agents, delegate tasks, and run integrations with third-party services.",
      "You are responsible for reviewing and approving critical outputs before using them in production workflows.",
    ],
  },
  {
    title: "Accounts and Security",
    body: [
      "You are responsible for safeguarding your account, API keys, integration credentials, and machine access.",
      "You must notify us promptly if you believe your account or credentials were compromised.",
    ],
  },
  {
    title: "Acceptable Use",
    body: [
      "You may not use Virtual Agency for illegal activity, abusive automation, credential theft, malware, or unauthorized data access.",
      "You may not attempt to bypass security controls or interfere with service availability.",
    ],
  },
  {
    title: "Third-Party Services",
    body: [
      "Virtual Agency can connect to third-party providers (for example Google, email providers, storage services, and automation platforms).",
      "Your use of third-party services is governed by their own terms and policies.",
    ],
  },
  {
    title: "Data and Content",
    body: [
      "You retain ownership of your data and content.",
      "You grant us a limited license to process data only as required to provide and secure the service.",
    ],
  },
  {
    title: "Disclaimers and Liability",
    body: [
      "The service is provided on an \"as is\" and \"as available\" basis.",
      "To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages.",
    ],
  },
  {
    title: "Termination",
    body: [
      "We may suspend or terminate access for violations of these terms or security risks.",
      "You may stop using the service at any time.",
    ],
  },
  {
    title: "Changes",
    body: [
      "We may update these Terms periodically. Material updates will be reflected by an updated effective date.",
    ],
  },
];

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "What We Collect",
    body: [
      "Account identifiers and profile details needed to authenticate users and provide access control.",
      "Operational telemetry such as request metadata, diagnostics, and service logs required for reliability and security.",
      "User-provided integration configuration and credentials, stored only as needed for requested automations.",
    ],
  },
  {
    title: "How We Use Data",
    body: [
      "To operate Virtual Agency, process user requests, run automations, and maintain system security.",
      "To troubleshoot errors, improve reliability, and enforce abuse prevention policies.",
    ],
  },
  {
    title: "Third-Party Processors",
    body: [
      "When you connect third-party services (for example Google APIs via OAuth), data is processed according to those providers' policies.",
      "We only request scopes and access necessary for selected features.",
    ],
  },
  {
    title: "Data Sharing",
    body: [
      "We do not sell personal data.",
      "We may share limited data with infrastructure, billing, and integration providers as required to deliver the service.",
    ],
  },
  {
    title: "Security",
    body: [
      "We use technical and organizational safeguards to reduce unauthorized access risk, including access controls and secret-handling practices.",
      "No system is perfectly secure; users are responsible for securing endpoints and credentials they control.",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We retain data only for as long as needed to provide the service, meet legal obligations, resolve disputes, and enforce agreements.",
    ],
  },
  {
    title: "Your Rights",
    body: [
      "You may request access, correction, or deletion of certain personal data, subject to legal and operational constraints.",
      "To exercise privacy requests, contact us using the email below.",
    ],
  },
  {
    title: "Changes",
    body: [
      "We may update this Privacy Policy from time to time. Material updates will be reflected by an updated effective date.",
    ],
  },
];

function titleForKind(kind: LegalPageKind): string {
  return kind === "terms" ? "Terms of Service" : "Privacy Policy";
}

function sectionsForKind(kind: LegalPageKind): LegalSection[] {
  return kind === "terms" ? TERMS_SECTIONS : PRIVACY_SECTIONS;
}

export function LegalPage({ kind }: LegalPageProps) {
  const title = titleForKind(kind);
  const sections = sectionsForKind(kind);

  return (
    <div className="min-h-screen bg-[#05070b] text-white">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-2 text-sm text-white/80 hover:text-white">
            <img src="/logo.svg" alt="Virtual Agency" className="h-6 w-6" />
            <span>Virtual Agency</span>
          </a>
          <a href="/app/" className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white">
            Open App
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-white/60">Effective date: {EFFECTIVE_DATE}</p>

        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-white">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-white/75">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2 text-sm text-white/75">
            Questions about this {title.toLowerCase()} can be sent to{" "}
            <a className="text-[#7dd3fc] hover:text-[#a5e4ff]" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
