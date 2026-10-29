import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { login } from './api';
import type { LoginResponse } from './api';
import { UserMobileApp } from './user';
import { AdminDashboard } from './admin';
import './login.css';

function LoginScreen({ onLogin }: { onLogin: (user: LoginResponse) => void }) {
  const [username, setUsername] = useState('user');
  const [password, setPassword] = useState('demo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = useRef<object | null>(null);
  useEffect(() => () => { pending.current = null; }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const attempt = {};
    pending.current = attempt;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const user = await login(username, password);
      if (pending.current === attempt) onLogin(user);
    } catch {
      if (pending.current === attempt) setMessage('화면을 열지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (pending.current === attempt) {
        pending.current = null;
        setIsSubmitting(false);
      }
    }
  }

  return (
    <main className="vf-login">
      <section className="vf-login__panel">
        <div>
          <p className="vf-login__brand">VeriFace</p>
          <h1>얼굴 인증</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            <span>아이디</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>비밀번호</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {message && <p className="vf-login__error" role="alert">{message}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '화면 여는 중' : '화면 열기'}
          </button>
        </form>
        <div className="vf-login__roles" aria-label="화면 역할 선택">
          <button type="button" disabled={isSubmitting} aria-pressed={username === 'user'} onClick={() => setUsername('user')}>사용자</button>
          <button type="button" disabled={isSubmitting} aria-pressed={username === 'admin'} onClick={() => setUsername('admin')}>관리자</button>
        </div>
      </section>
    </main>
  );
}


export function App() {
  const [currentUser, setCurrentUser] = useState<LoginResponse | null>(null);

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  const handleLogout = () => setCurrentUser(null);
  if (currentUser.role === 'user') {
    return <UserMobileApp user={currentUser} onLogout={handleLogout} />;
  }

  return <AdminDashboard user={currentUser} onLogout={handleLogout} />;
}
