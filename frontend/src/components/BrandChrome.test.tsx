import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Footer } from './Footer';
import { CornerLinks } from './CornerLinks';

const brand = vi.hoisted(() => ({ isBranded: false }));
vi.mock('../config/brand', () => ({ BRAND: brand }));
vi.mock('./SuggestionModal', () => ({ SuggestionModal: () => null }));

describe('PizzaDAO footer and corner links', () => {
  beforeEach(() => {
    brand.isBranded = false;
  });

  it('unbranded: footer shows the PizzaDAO logo link', () => {
    const { container } = render(<Footer />);
    expect(container.querySelector('a[href="https://pizzadao.org"]')).not.toBeNull();
  });

  it('unbranded: corner links show the suggestion pencil and GitHub link', () => {
    const { container } = render(<CornerLinks />);
    expect(container.querySelector('button[aria-label="Suggest an improvement"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://github.com/PizzaDAO/rsv-pizza"]')).not.toBeNull();
  });

  it('branded: footer renders nothing', () => {
    brand.isBranded = true;
    const { container } = render(<Footer />);
    expect(container.firstChild).toBeNull();
  });

  it('branded: corner links render nothing', () => {
    brand.isBranded = true;
    const { container } = render(<CornerLinks />);
    expect(container.firstChild).toBeNull();
  });
});
