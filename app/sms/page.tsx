import Image from "next/image";
import { getPrivacyPolicyUrl, getTermsUrl } from "@/lib/sms/legalUrls";
import { SmsSubscribeForm } from "@/components/sms/SmsSubscribeForm";

export default function SmsSubscribePage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-chrome px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card overflow-hidden border-chrome-border! bg-chrome-elevated! shadow-[var(--shadow-md)]">
          <div className="h-1 bg-accent" aria-hidden="true" />

          <div className="card-body space-y-6 p-6 sm:p-8">
            <div className="flex flex-col items-start gap-3">
              <Image
                src="/otomoto-logo.png"
                alt="OTOMOTO Toronto Moto"
                width={180}
                height={62}
                className="h-11 w-auto"
                priority
              />
              <div>
                <h1 className="text-lg font-semibold text-chrome-foreground">
                  Toronto Moto text alerts
                </h1>
                <p className="mt-1 text-sm text-chrome-muted">
                  Sign up for service updates and promotional offers by text.
                </p>
              </div>
            </div>

            <SmsSubscribeForm
              privacyUrl={getPrivacyPolicyUrl()}
              termsUrl={getTermsUrl()}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
