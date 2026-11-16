/** Credit for the open-source booth (Apache-2.0). Shown on the booth page and in the host tab. */
export function BoothCredit({ className = '' }: { className?: string }) {
  const link = 'underline hover:text-white/70';
  return (
    <p className={`text-xs text-white/40 ${className}`} data-testid="booth-credit">
      Photo booth by{' '}
      <a href="https://x.com/simarpreet_019" target="_blank" rel="noopener noreferrer" className={link}>Simarpreet Singh</a>
      {' · '}
      <a href="https://github.com/simarpreetsingh-019/questpass-booth" target="_blank" rel="noopener noreferrer" className={link}>QuestPass Booth</a>
      {' '}(open source, Apache-2.0)
    </p>
  );
}
