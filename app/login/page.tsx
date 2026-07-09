"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/database/supabase-browser";

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
    <main className="flex min-h-full flex-1 items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-start gap-4">
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={180}
            height={62}
            className="h-12 w-auto"
            priority
          />
          <p className="text-sm text-zinc-400">
            Sign in to the workshop management app.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-zinc-200"
            >
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
              className="min-h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-3 text-base text-white outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-200"
            >
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
              className="min-h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-3 text-base text-white outline-none focus:border-zinc-500"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full rounded bg-white px-4 text-base font-medium text-zinc-950 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-10 border-t border-zinc-800 pt-6">
          <Image
            src="/otomoto-service-logo.png"
            alt="OTOMOTO Moto Service"
            width={160}
            height={124}
            className="h-16 w-auto opacity-80"
          />
        </div>
      </div>
    </main>
  );
}
