import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../components/ui';
export default function NotFoundPage() {
  return <div className="grid min-h-screen place-items-center px-4"><EmptyState title="Page not found" message="The page you are looking for does not exist or has moved." action={<Link to="/"><Button>Go to home</Button></Link>} /></div>;
}
