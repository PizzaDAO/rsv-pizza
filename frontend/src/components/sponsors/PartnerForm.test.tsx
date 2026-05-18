import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartnerForm } from './PartnerForm';
import type { PartnerIntakeResponse } from '../../lib/api';

// Mock supabase storage — intake mode can call uploadSponsorLogo on file upload
vi.mock('../../lib/supabase', () => ({
  uploadSponsorLogo: vi.fn().mockResolvedValue('https://example.com/logo.png'),
}));

const makeIntakeStub = (
  overrides?: Partial<PartnerIntakeResponse['sponsor']>
): PartnerIntakeResponse['sponsor'] => ({
  name: 'Acme Pizza Co.',
  website: 'https://acme.example',
  brandTwitter: 'acme',
  brandInstagram: 'acme_ig',
  brandDescription: 'We make great pizza.',
  contactName: 'Jane Doe',
  contactEmail: 'jane@acme.example',
  contactPhone: '555-0100',
  contactTwitter: 'jane',
  telegram: 'jane_tg',
  sponsorshipType: 'pizza',
  productService: 'Pizzas for the event',
  logoUrl: null,
  sponsorMessage: '',
  intakeSubmittedAt: null,
  ...overrides,
});

describe('PartnerForm mode="intake"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders intake-only fields and hides CRM/partner-only sections', () => {
    const mockSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <PartnerForm
        mode="intake"
        intakeInitialData={makeIntakeStub()}
        eventName="Test Pizza Event"
        onSubmit={mockSubmit}
      />
    );

    // Intake-specific fields should be present
    expect(screen.getByPlaceholderText(/Company \/ Brand Name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/1-2 sentence description/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^Email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Any notes or special requests/i)).toBeInTheDocument();

    // Section headings
    expect(screen.getByText('Company Info')).toBeInTheDocument();
    expect(screen.getByText('Contact Info')).toBeInTheDocument();
    expect(screen.getByText('Partnership Details')).toBeInTheDocument();
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByText('Message to Host')).toBeInTheDocument();

    // Non-intake sections should NOT be rendered
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Fundraising')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Partner Intake Form')).not.toBeInTheDocument();
    expect(screen.queryByText('Automation')).not.toBeInTheDocument();
    expect(screen.queryByText('Co-Host Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Point Person/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^Amount/i)).not.toBeInTheDocument();
  });

  it('renders a full-width submit button with intake copy and no modal chrome', () => {
    const mockSubmit = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PartnerForm
        mode="intake"
        intakeInitialData={makeIntakeStub()}
        eventName="Test Pizza Event"
        onSubmit={mockSubmit}
      />
    );

    // No modal backdrop — intake mode should render the bare form, not the fixed-positioned modal wrapper
    expect(container.querySelector('.fixed.inset-0')).toBeNull();

    // Submit button should exist, be full-width, and say "Submit Information"
    const submitButton = screen.getByRole('button', { name: /Submit Information/i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton.className).toMatch(/w-full/);
  });

  it('shows "Update Information" copy when wasPreviouslySubmitted is true', () => {
    const mockSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <PartnerForm
        mode="intake"
        intakeInitialData={makeIntakeStub({ intakeSubmittedAt: '2026-04-01T12:00:00Z' })}
        eventName="Test Pizza Event"
        wasPreviouslySubmitted
        onSubmit={mockSubmit}
      />
    );

    expect(screen.getByRole('button', { name: /Update Information/i })).toBeInTheDocument();
  });

  it('calls onSubmit with a shaped PartnerFormData payload when submit is clicked', async () => {
    const user = userEvent.setup();
    const mockSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <PartnerForm
        mode="intake"
        intakeInitialData={makeIntakeStub({ name: '' })}
        eventName="Test Pizza Event"
        onSubmit={mockSubmit}
      />
    );

    // Fill in the required name field
    const nameInput = screen.getByPlaceholderText(/Company \/ Brand Name/i);
    await user.type(nameInput, 'New Pizza Sponsor');

    // Click submit
    const submitButton = screen.getByRole('button', { name: /Submit Information/i });
    await user.click(submitButton);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const payload = mockSubmit.mock.calls[0][0];
    expect(payload.name).toBe('New Pizza Sponsor');
    // Intake initial data should still be present in the payload from prefill
    expect(payload.brandDescription).toBe('We make great pizza.');
    expect(payload.contactEmail).toBe('jane@acme.example');
    expect(payload.sponsorshipType).toBe('pizza');
  });
});
