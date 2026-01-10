import React from 'react';
import { PizzaProvider } from '../contexts/PizzaContext';
import { Layout } from '../components/Layout';
import { GuestList } from '../components/GuestList';
import { AddGuestForm } from '../components/AddGuestForm';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { PizzaSettings } from '../components/PizzaSettings';

export function HomePage() {
  return (
    <PizzaProvider>
      <Layout>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <header className="text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Pizza Party Planner
            </h1>
            <p className="text-white/60 max-w-2xl mx-auto">
              Collect pizza preferences from your guests and get the perfect pizza order recommendations for your party!
            </p>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <PizzaSettings />
              <AddGuestForm />
              <GuestList />
            </div>
            <div className="xl:col-span-1">
              <PizzaOrderSummary />
            </div>
          </div>
        </div>
      </Layout>
    </PizzaProvider>
  );
}
