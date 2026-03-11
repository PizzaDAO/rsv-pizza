import React from 'react';
import { BookOpen, MessageCircle, HelpCircle, Presentation, ExternalLink } from 'lucide-react';

const resources = [
  {
    title: 'Sponsor One Sheet',
    description: 'Everything you need to talk to sponsors about the Global Pizza Party.',
    href: 'https://docs.google.com/presentation/d/e/2PACX-1vQHSFx8OYH1yznE4XjiqD9TTOyCqkPVNyeOTVpkOghZleUKm-ISp09JNvksbo_hvfzDG-4MQLRV9u1q/pub?start=false&loop=false&delayms=3000',
    icon: BookOpen,
    color: '#ff393a',
  },
  {
    title: 'Sponsor Intro',
    description: 'A presentation to introduce potential sponsors to the Global Pizza Party.',
    href: 'https://docs.google.com/presentation/d/e/2PACX-1vT5ORtWk-nHCBckmOSGXWbjosenIXB8p1kJx9DuZMl1IgN9UU3ohcpj--kFobe92YHCbgQVYDSRQzkJ/pub?start=false&loop=false&delayms=3000',
    icon: Presentation,
    color: '#f59e0b',
  },
  {
    title: 'Telegram Community',
    description: 'Join fellow hosts and the PizzaDAO team for support and coordination.',
    href: 'https://t.me/+Qr-B8Y6DYH4yMjIx',
    icon: MessageCircle,
    color: '#22c55e',
  },
  {
    title: 'PizzaDAO Resources',
    description: 'A guide to all the PizzaDAO websites and apps out there.',
    href: 'https://pizzadao.xyz/landing',
    icon: HelpCircle,
    color: '#5c7cfa',
  },
];

export const HostResources: React.FC = () => (
  <div>
    <h3 className="text-lg font-semibold text-theme-text mb-4">Host Resources</h3>
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
      {resources.map((r) => {
        const Icon = r.icon;
        return (
          <a
            key={r.title}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="card p-5 flex flex-col gap-3 hover:-translate-y-1 hover:shadow-lg transition-all group"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: `${r.color}20` }}
            >
              <Icon size={20} style={{ color: r.color }} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-theme-text font-medium text-sm mb-1">
                {r.title}
                <ExternalLink size={12} className="text-theme-text-faint group-hover:text-theme-text-secondary transition-colors" />
              </div>
              <p className="text-xs text-theme-text-muted">{r.description}</p>
            </div>
          </a>
        );
      })}
    </div>
  </div>
);
