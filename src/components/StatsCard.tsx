import { motion } from "motion/react";
import { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  className?: string;
}

export function StatsCard({ title, value, icon: Icon, description, className }: StatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1, transition: { duration: 0.2 } }}
      className={cn(
        "bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{title}</span>
        <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Icon size={14} />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{value}</span>
        {description && description.includes("+") && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/20 rounded-md">
            {description.split(' ')[0]}
          </span>
        )}
      </div>
      {description && !description.includes("+") && (
        <div className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-tight mt-1">{description}</div>
      )}
    </motion.div>
  );
}
