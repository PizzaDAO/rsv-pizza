import React from 'react';
import { PieChart } from 'lucide-react';

interface ReportRoleChartProps {
  roleBreakdown: Record<string, number>;
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

export function ReportRoleChart({ roleBreakdown }: ReportRoleChartProps) {
  const entries = Object.entries(roleBreakdown).filter(([_, count]) => count > 0);
  const total = entries.reduce((sum, [_, count]) => sum + count, 0);

  if (total === 0) {
    return (
      <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-center">
        <PieChart className="w-12 h-12 text-white/20 mx-auto mb-3" />
        <p className="text-white/40 text-sm">No role data available</p>
      </div>
    );
  }

  // Calculate percentages and create pie chart segments
  const segments: Array<{ role: string; count: number; percentage: number; color: string; startAngle: number; endAngle: number }> = [];
  let currentAngle = -90; // Start from top

  entries.forEach(([role, count], index) => {
    const percentage = (count / total) * 100;
    const angle = (percentage / 100) * 360;
    segments.push({
      role,
      count,
      percentage,
      color: getRoleColor(role, index),
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
    });
    currentAngle += angle;
  });

  // Generate SVG pie chart
  const size = 200;
  const center = size / 2;
  const radius = 80;

  function polarToCartesian(angle: number): { x: number; y: number } {
    const radians = (angle * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(radians),
      y: center + radius * Math.sin(radians),
    };
  }

  function describeArc(startAngle: number, endAngle: number): string {
    const start = polarToCartesian(endAngle);
    const end = polarToCartesian(startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      'M', center, center,
      'L', start.x, start.y,
      'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      'Z',
    ].join(' ');
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">RSVP Roles</h3>
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Pie Chart */}
          <div className="flex-shrink-0">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {segments.map((segment, index) => (
                <path
                  key={index}
                  d={describeArc(segment.startAngle, segment.endAngle)}
                  fill={segment.color}
                  stroke="#1a1a2e"
                  strokeWidth="2"
                  className="transition-opacity hover:opacity-80 cursor-pointer"
                >
                  <title>{`${segment.role}: ${segment.count} (${segment.percentage.toFixed(1)}%)`}</title>
                </path>
              ))}
              {/* Center circle for donut effect */}
              <circle cx={center} cy={center} r={radius * 0.5} fill="#1a1a2e" />
              {/* Total in center */}
              <text
                x={center}
                y={center - 5}
                textAnchor="middle"
                className="fill-white text-2xl font-bold"
              >
                {total}
              </text>
              <text
                x={center}
                y={center + 15}
                textAnchor="middle"
                className="fill-white/60 text-xs"
              >
                RSVPs
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div className="flex-1 grid grid-cols-2 gap-2">
            {segments.map((segment, index) => (
              <div key={index} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="text-sm text-white/80 truncate">{segment.role}</span>
                <span className="text-sm text-white/40 ml-auto">
                  {segment.count} ({segment.percentage.toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
