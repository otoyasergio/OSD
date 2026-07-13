"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/database/supabase-browser";
import { assertLoginAllowed } from "@/app/login/actions";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const gate = await assertLoginAllowed();
      if (gate.error) {
        setError(gate.error);
        return;
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setPending(false);
    }
  }

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
                  Workshop sign in
                </h1>
                <p className="mt-1 text-sm text-chrome-muted">
                  Access work orders, inspections, and shop operations.
                </p>
              </div>
            </div>

            <form onSubmit={onSubmit} method="post" className="space-y-4">
              <div>
                <label htmlFor="email" className="field-label text-chrome-foreground">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-dark"
                />
              </div>

              <div>
                <label htmlFor="password" className="field-label text-chrome-foreground">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-dark"
                />
              </div>

              {error ? (
                <p className="alert-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="btn btn-accent w-full text-base"
              >
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <Image
            src="/otomoto-service-logo.png"
            alt="OTOMOTO Moto Service"
            width={160}
            height={124}
            className="h-14 w-auto opacity-70"
          />
        </div>
      </div>
    </main>
  );
}
