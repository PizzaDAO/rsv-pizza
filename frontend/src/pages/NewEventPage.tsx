import { Layout } from '../components/Layout';
import { EventForm } from '../components/EventForm';

export function NewEventPage() {
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8">
          <EventForm />
        </div>
      </div>
    </Layout>
  );
}
