'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/kallieClient';

export function AuthGate() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) setError(signInError.message);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
        } else if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background flex min-h-svh w-full items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="border-border bg-card w-full max-w-sm space-y-4 rounded-2xl border p-7 shadow-xl"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">Kallie</h1>
          <p className="text-muted-foreground text-xs">
            {mode === 'login'
              ? 'Sign in to talk with your AI voice assistant'
              : 'Create your Kallie account'}
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-muted-foreground font-mono text-[11px] uppercase">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/40 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-muted-foreground font-mono text-[11px] uppercase">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/40 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              required
            />
          </div>
        </div>

        {error && <p className="text-destructive text-xs">{error}</p>}
        {notice && <p className="text-xs text-emerald-400">{notice}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={loading}
          className="w-full rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setNotice(null);
            setMode(mode === 'login' ? 'register' : 'login');
          }}
          className="text-muted-foreground hover:text-foreground w-full text-center text-xs transition-colors"
        >
          {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
