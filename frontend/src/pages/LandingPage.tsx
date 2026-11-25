import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Target, Zap } from 'lucide-react';
import { Logo } from '../components/layout/Logo';
import { ClipboardScene } from '../components/illustrations/Illustrations';
import { Button } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const FEATURES = [
  { icon: Zap, tone: 'text-amber', title: 'Smart Recommendations', text: 'Find the most important task for your current context.' },
  { icon: Target, tone: 'text-terracotta', title: 'Stay Focused', text: 'Plan sessions around your time, energy and focus.' },
  { icon: BarChart3, tone: 'text-olive', title: 'Track Progress', text: 'See your productivity and task completion trends.' },
];

export default function LandingPage() {
  const { status } = useAuth();
  const authed = status === 'authenticated';
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm sm:gap-6">
          <a href="#features" className="hidden hover:underline sm:inline">Features</a>
          <a href="#how-it-works" className="hidden hover:underline sm:inline">How it Works</a>
          <a href="#about" className="hidden hover:underline sm:inline">About</a>
          {authed ? <Link to="/dashboard"><Button size="sm">Open Dashboard</Button></Link> : (
            <><Link to="/login"><Button size="sm" variant="secondary">Log In</Button></Link><Link to="/register"><Button size="sm">Sign Up</Button></Link></>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-6 pb-14 pt-8 md:grid-cols-2">
          <div>
            <h1 className="text-5xl font-semibold leading-[1.08] sm:text-6xl">Know What to Do Next</h1>
            <p className="mt-5 max-w-md text-base text-muted">An intelligent task planner that recommends what to work on, right now, based on your goals, time, energy and priorities.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={authed ? '/dashboard' : '/register'}><Button>Get Started Free <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button></Link>
              <a href="#how-it-works"><Button variant="secondary">Learn More</Button></a>
            </div>
          </div>
          <ClipboardScene className="mx-auto w-full max-w-md" />
        </section>

        <section id="features" aria-label="Features" className="mx-auto grid max-w-6xl gap-6 px-6 pb-14 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, tone, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className={`mt-1 h-6 w-6 shrink-0 ${tone}`} aria-hidden="true" />
              <div><h2 className="font-sans text-sm font-semibold">{title}</h2><p className="text-sm text-muted">{text}</p></div>
            </div>
          ))}
        </section>

        <section id="how-it-works" className="border-y border-line bg-surface-2/60 py-14">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold">How it works</h2>
            <ol className="mt-6 grid gap-6 sm:grid-cols-3">
              {[['Add your tasks', 'Capture importance, goals, deadlines, effort and the best time of day.'], ['Describe your session', 'Tell WorkToDo how much time, energy and focus you have right now.'], ['Get a ranked plan', 'A trained model scores every eligible task and explains why each one made the list.']].map(([t, d], i) => (
                <li key={t} className="card p-5"><span className="font-serif text-2xl font-semibold text-terracotta">{i + 1}</span><h3 className="mt-1 font-sans text-base font-semibold">{t}</h3><p className="mt-1 text-sm text-muted">{d}</p></li>
              ))}
            </ol>
          </div>
        </section>
        <section id="about" className="mx-auto max-w-3xl px-6 py-14 text-center">
          <h2 className="text-3xl font-semibold">About WorkToDo</h2>
          <p className="mt-3 text-sm text-muted">WorkToDo is a full-stack productivity project. Recommendations come from a seven-factor machine-learning model served by a Python service; your tasks, sessions and recommendation history are stored in PostgreSQL.</p>
        </section>
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">© {new Date().getFullYear()} WorkToDo</footer>
    </div>
  );
}
