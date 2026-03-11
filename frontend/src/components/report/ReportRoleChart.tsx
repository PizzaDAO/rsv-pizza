import React from 'react';
import { BarChart3 } from 'lucide-react';

interface ReportRoleChartProps {
  roleBreakdown: Record<string, number>;
  totalRsvps: number;
}

// Role colors based on common role types
const ROLE_COLORS: Record<string, string> = {
  'Dev': '#3B82F6',      // blue
  'Developer': '#3B82F6',
  'Designer': '#EC4899', // pink
  'Artist': '#8B5CF6',   // purple
  'Biz Dev': '#10B981',  // emerald
  'Marketing': '#F59E0B', // amber
  'Ops': '#6366F1',      // indigo
  'Student': '#14B8A6',  // teal
  'Founder': '#EF4444',  // red
  'Investor': '#84CC16', // lime
  'Other': '#6B7280',    // gray
};

// Get a color for a role, with fallback
function getRoleColor(role: string, index: number): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];

  // Fallback colors for unknown roles
  const fallbackColors = [
    '#3B82F6', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B',
    '#6366F1', '#14B8A6', '#EF4444', '#84CC16', '#6B7280',
  ];
  return fallbackColors[index % fallbackColors.length];
}

export function ReportRoleChart({ roleBreakdown, totalRsvps }: ReportRoleChartProps) {
  const entries = Object.entries(roleBreakdown).filter(([_, count]) => count > 0);
  const totalSelections = entries.reduce((sum, [_, count]) => sum + count, 0);

  if (totalSelections === 0) {
    return (
      <div className="card p-6 text-center">
        <BarChart3 className="w-12 h-12 text-theme-text-faint mx-auto mb-3" />
        <p className="text-theme-text-muted text-sm">No role data available</p>
      </div>
    );
  }

  // Sort by count descending
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);

  // Use totalRsvps for percentage calculation (% of guests who selected each role)
  const base = totalRsvps > 0 ? totalRsvps : totalSelections;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-theme-text">RSVP Roles</h3>
      <div className="card p-6">
        {/* Summary line */}
        <p className="text-theme-text-muted text-xs mb-4">
          {base} RSVPs / {totalSelections} role selections
          {totalSelections > base && ' (guests can select multiple roles)'}
        </p>

        {/* Horizontal bar chart */}
        <div className="space-y-3">
          {sorted.map(([role, count], index) => {
            const percentage = (count / base) * 100;
            const color = getRoleColor(role, index);

            return (
              <div key={role}>
                {/* Label row */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm text-theme-text">{role}</span>
                  </div>
                  <span className="text-sm text-theme-text-muted">
                    {count} ({percentage.toFixed(0)}% of guests)
                  </span>
                </div>
                {/* Bar */}
                <div className="w-full h-5 bg-theme-surface rounded-md overflow-hidden">
                  <div
                    className="h-full rounded-md transition-all duration-500"
                    style={{
                      width: `${Math.min(percentage, 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
