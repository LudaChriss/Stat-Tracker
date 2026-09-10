// Form state for the sign-in screen.
//
// Kept out of the screen so the screen stays presentational, and out of
// useBackend so the two are testable apart.

import { useCallback, useState } from 'react';
import { authErrorMessage } from './auth.js';

export function useSignInForm(auth) {
  const [mode, setMode] = useState('code');
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(authErrorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const sendCode = useCallback(async () => {
    if (!email.trim()) return;
    await run(async () => {
      const { error: err } = await auth.sendCode(email);
      if (err) {
        setError(authErrorMessage(err));
        setNotice(null);
        return;
      }
      setStep('code');
      setCode('');
      setNotice(`Code sent to ${email.trim()}. It expires in an hour.`);
    });
  }, [auth, email, run]);

  const verifyCode = useCallback(async () => {
    if (code.length !== 6) return;
    await run(async () => {
      const { error: err } = await auth.verifyCode(email, code);
      // On success the auth listener in useBackend takes over from here.
      if (err) setError(authErrorMessage(err));
    });
  }, [auth, code, email, run]);

  const signInWithPassword = useCallback(async () => {
    if (!email.trim() || !password) return;
    await run(async () => {
      const { error: err } = await auth.signInWithPassword(email, password);
      if (err) setError(authErrorMessage(err));
    });
  }, [auth, email, password, run]);

  return {
    mode,
    step,
    email,
    code,
    password,
    busy,
    error,
    notice,
    onEmailChange: (v) => {
      setEmail(v);
      setError(null);
    },
    onCodeChange: (v) => {
      setCode(String(v).replace(/[^0-9]/g, '').slice(0, 6));
      setError(null);
    },
    onPasswordChange: (v) => {
      setPassword(v);
      setError(null);
    },
    onSendCode: sendCode,
    onVerifyCode: verifyCode,
    onSignInWithPassword: signInWithPassword,
    onUseCode: () => {
      setMode('code');
      setStep('email');
      setError(null);
      setNotice(null);
    },
    onUsePassword: () => {
      setMode('password');
      setError(null);
      setNotice(null);
    },
    onBack: () => {
      setStep('email');
      setCode('');
      setError(null);
      setNotice(null);
    },
  };
}
