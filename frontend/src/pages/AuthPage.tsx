import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, TrainFront, User } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { apiUrl, setTokens, type Tokens } from '../utils/auth'

type Props = {
  mode: 'login' | 'register'
  // Optional: lets App refresh its user state (e.g. fetchUser) right after tokens are stored.
  onLoginSuccess?: () => void | Promise<void>
}

type AuthResponse = {
  message?: string
  tokens?: Tokens
}

export default function AuthPage({ mode, onLoginSuccess }: Props) {
  const isRegister = mode === 'register'
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Shared by email login, signup and Google login: POST, store tokens, enter the app.
  async function authenticate(path: string, payload: Record<string, string>) {
    setNotice('')
    setSubmitting(true)
    try {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: AuthResponse = await response.json().catch(() => ({}))

      if (!response.ok || !data.tokens) {
        setNotice(data.message ?? 'Authentication failed. Please try again.')
        return
      }

      setTokens(data.tokens)
      await onLoginSuccess?.()
      navigate('/')
    } catch {
      setNotice('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    if (isRegister) {
      // First and last name are separate fields; the API also wants a username (we use the email).
      await authenticate('/api/signup/', {
        email,
        password,
        username: email,
        first_name: String(form.get('first_name') ?? '').trim(),
        last_name: String(form.get('last_name') ?? '').trim(),
      })
    } else {
      await authenticate('/api/user_login/', { email, password })
    }
  }

  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) {
      setNotice('Google sign-in failed. Please try again.')
      return
    }
    await authenticate('/api/google_login/', { google_token: credentialResponse.credential })
  }

  return (
    <main className="auth-page">
      <section className="auth-form-side">
        <Link to="/" className="auth-brand">
          <span className="brand-mark"><TrainFront size={19} /></span>
          <span className="brand-name">QUANTUM <b>RAIL</b></span>
        </Link>
        <motion.div className="auth-content" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>
          <div className="auth-kicker"><span /> ROMANIA NETWORK OPERATIONS</div>
          <h1>{isRegister ? 'Create your account.' : 'A smarter way through Romania.'}</h1>
          <p className="auth-subtitle">
            {isRegister ? 'Join the network intelligence platform built for better journeys.' : 'Sign in to your network intelligence workspace.'}
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isRegister && (
              <div className="name-row">
                <label className="field-label">
                  First name
                  <span className="input-wrap"><User size={15} /><input className="text-input" name="first_name" autoComplete="given-name" placeholder="First name" required /></span>
                </label>
                <label className="field-label">
                  Last name
                  <span className="input-wrap"><User size={15} /><input className="text-input" name="last_name" autoComplete="family-name" placeholder="Last name" required /></span>
                </label>
              </div>
            )}
            <label className="field-label">
              Work email
              <span className="input-wrap"><Mail size={15} /><input className="text-input" type="email" name="email" autoComplete="email" placeholder="you@company.com" required /></span>
            </label>
            <label className="field-label">
              Password
              <span className="input-wrap"><LockKeyhole size={15} /><input className="text-input" type={showPassword ? 'text' : 'password'} name="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="Enter your password" minLength={8} required /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
            </label>
            {!isRegister && <div className="auth-options"><label className="remember-check"><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="text-link" onClick={() => setNotice('Password reset is not connected in this demo.')}>Forgot password?</button></div>}
            <button className="button button-primary auth-submit" type="submit" disabled={submitting}>{isRegister ? 'Create account' : 'Sign in to workspace'} <ArrowRight size={16} /></button>
          </form>

          <div className="auth-divider"><span /> <span>OR</span> <span /></div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setNotice('Google sign-in failed. Please try again.')}
              text={isRegister ? 'signup_with' : 'signin_with'}
              theme="outline"
              size="large"
            />
          </div>
          <div className="auth-notice" role="status">{notice}</div>
          <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Quantum Rail?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p>
        </motion.div>
        <div className="auth-footer"><span>© {new Date().getFullYear()} Quantum Rail</span><span>Secure network access <i /></span></div>
      </section>

      <section className="auth-visual" aria-label="Railway journey through the mountains">
        <div className="auth-visual-overlay" />
        <div className="visual-topline"><span>QUANTUM RAIL</span><span>BUILT FOR WHAT'S NEXT</span></div>
        <motion.div className="visual-copy" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .15 }}>
          <span className="visual-kicker">ROMANIA, CONNECTED</span>
          <h2>Every connection.<br />A new possibility.</h2>
          <p>Move through Romania with a clearer view of every route ahead.</p>
        </motion.div>
        <div className="visual-bottom">
          <span className="visual-caption">THE FUTURE OF RAIL, IN MOTION</span>
          <div className="visual-stats"><span><strong>8</strong> key cities</span><i /><span><strong>1</strong> connected network</span></div>
        </div>
      </section>
    </main>
  )
}