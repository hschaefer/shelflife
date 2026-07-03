import { useEffect, useRef } from "react";
import { format, subDays, eachDayOfInterval, differenceInWeeks, getDay, startOfWeek, addDays } from "date-fns";
import Plotly from "plotly.js-dist-min";
import { cn } from "../lib/utils";

interface ActivityHeatmapProps {
  data: Record<string, number>; // date string (YYYY-MM-DD) -> duration in seconds
  title: string;
  isDark?: boolean;
}

export function ActivityHeatmap({ data, title, isDark = false }: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const levelStyles = [
    "heatmap-0",
    "heatmap-1",
    "heatmap-2",
    "heatmap-3",
    "heatmap-4",
  ];

  const getLevel = (seconds: number) => {
    if (!seconds || seconds === 0) return 0;
    if (seconds < 1800) return 1; // < 30m
    if (seconds < 3600) return 2; // < 1h
    if (seconds < 7200) return 3; // < 2h
    return 4; // > 2h
  };

  const formatHoverText = (day: Date, durationSeconds: number) => {
    const formattedDate = format(day, "EEEE, MMMM d, yyyy");
    if (!durationSeconds || durationSeconds === 0) {
      return `<b>${formattedDate}</b><br>No activity logged`;
    }
    const mins = Math.round(durationSeconds / 60);
    if (mins < 60) {
      return `<b>${formattedDate}</b><br><span style="color: #818cf8; font-weight: bold">${mins}m</span> listened`;
    } else {
      const hrs = parseFloat((mins / 60).toFixed(1));
      return `<b>${formattedDate}</b><br><span style="color: #818cf8; font-weight: bold">${hrs}h</span> listened`;
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const end = new Date();
    // 52 weeks ago, aligned to Sunday
    const start = startOfWeek(subDays(end, 363));
    const days = eachDayOfInterval({ start, end });

    const numWeeks = differenceInWeeks(end, start) + 1;

    // Initialize 7 rows (Sunday to Saturday) and numWeeks columns
    const z: number[][] = Array.from({ length: 7 }, () => Array(numWeeks).fill(0));
    const hovertext: string[][] = Array.from({ length: 7 }, () => Array(numWeeks).fill(""));

    // Populate x-axis values (starting Sunday of each week)
    const x = Array.from({ length: numWeeks }).map((_, c) => {
      const weekSunday = addDays(start, c * 7);
      return format(weekSunday, "yyyy-MM-dd");
    });

    const y = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Fill in z matrix and hover text
    days.forEach((day) => {
      const c = differenceInWeeks(day, start);
      const r = getDay(day); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const dateStr = format(day, "yyyy-MM-dd");
      const durationSeconds = data[dateStr] || 0;
      
      z[r][c] = getLevel(durationSeconds);
      hovertext[r][c] = formatHoverText(day, durationSeconds);
    });

    const colorscale: [number, string][] = isDark ? [
      [0.0, '#1e293b'],   // level 0: GitHub dark grid color
      [0.25, '#0f358c'],  // level 1: dark mode indigo-900
      [0.5, '#154ec1'],   // level 2: dark mode indigo-800
      [0.75, '#1f6feb'],  // level 3: dark mode indigo-500
      [1.0, '#58a6ff'],   // level 4: dark mode indigo-200
    ] : [
      [0.0, '#ebedf0'],   // level 0: GitHub light grid color
      [0.25, '#b6e3ff'],  // level 1: light mode indigo-100
      [0.5, '#54aeff'],   // level 2: light mode indigo-200
      [0.75, '#218bff'],  // level 3: light mode indigo-300
      [1.0, '#0969da'],   // level 4: light mode indigo-600
    ];

    const plotData = [{
      z: z,
      x: x,
      y: y,
      type: 'heatmap' as const,
      colorscale: colorscale,
      zmin: 0,
      zmax: 4,
      showscale: false, // Hide the side colorbar
      xgap: 2,
      ygap: 2,
      hoverinfo: 'text' as const,
      text: hovertext as any,
      hoverlabel: {
        bgcolor: isDark ? '#1e293b' : '#0f172a',
        bordercolor: isDark ? '#334155' : '#0f172a',
        font: {
          family: 'Inter, system-ui, sans-serif',
          size: 10,
          color: isDark ? '#f8fafc' : '#ffffff'
        },
        align: 'left' as const
      }
    }];

    const layout = {
      margin: { t: 5, r: 5, b: 20, l: 30 },
      height: 130,
      autosize: true,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: {
        type: 'date' as const,
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: '' as const,
        fixedrange: true, // Disable zoom/pan
        tickfont: {
          family: 'Inter, system-ui, sans-serif',
          size: 8,
          color: isDark ? '#94a3b8' : '#64748b',
          weight: 'bold' as const
        }
      },
      yaxis: {
        autorange: 'reversed' as const, // Put Sunday at top, Saturday at bottom
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: '' as const,
        fixedrange: true, // Disable zoom/pan
        tickvals: [1, 3, 5], // Label only Mon, Wed, Fri
        ticktext: ['Mon', 'Wed', 'Fri'],
        tickfont: {
          family: 'Inter, system-ui, sans-serif',
          size: 8,
          color: isDark ? '#94a3b8' : '#64748b',
          weight: 'bold' as const
        }
      }
    };

    const config = {
      responsive: true,
      displayModeBar: false
    };

    Plotly.newPlot(containerRef.current, plotData, layout, config);

    // Cleanup plot on unmount or data change
    return () => {
      if (containerRef.current) {
        Plotly.purge(containerRef.current);
      }
    };
  }, [data, isDark]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header Info */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-tight">{title}</h2>
          <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
            Playback intensity over the last 12 months
          </p>
        </div>
        
        {/* Dynamic Legend */}
        <div className="flex gap-3 items-center px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <span className="text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter">Quiet</span>
          <div className="flex gap-1">
            {levelStyles.map((style, i) => (
              <div key={i} className={cn("w-2 h-2 rounded-sm border border-black/5 dark:border-white/5", style)} />
            ))}
          </div>
          <span className="text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter">Vibrant</span>
        </div>
      </div>

      {/* Plotly Heatmap Container */}
      <div className="w-full overflow-hidden">
        <div ref={containerRef} className="w-full h-[130px]" />
      </div>
    </div>
  );
}

