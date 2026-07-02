import { Book } from "../types";
import { BookOpen, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CoverImage } from "./CoverImage";

interface RecentItemsProps {
  items: Book[];
  onBookClick?: (book: Book) => void;
}

export function RecentItems({ items, onBookClick }: RecentItemsProps) {
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <div className="p-4 text-center text-slate-400 text-[10px] italic">
          No recent items found in repository.
        </div>
      ) : (
        items.slice(0, 5).map((book) => (
          <div 
            key={book.id} 
            className="flex gap-3 p-1.5 rounded-md cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            onClick={() => onBookClick?.(book)}
          >
            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden flex-shrink-0 shadow-sm border border-slate-200 dark:border-slate-800 relative">
              <CoverImage
                itemId={book.id}
                title={book.metadata?.title}
                className="w-full h-full object-cover aspect-square"
              />
            </div>
            <div className="flex flex-col justify-center min-w-0 flex-1">
              <span className="text-xs font-bold truncate text-slate-900 dark:text-slate-100 mb-0.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {book.metadata?.title || "Unknown Title"}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mb-1">
                {book.metadata?.authorName || "Unknown Author"}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-tighter">
                  {book.addedAt ? `Added ${formatDistanceToNow(book.addedAt)} ago` : 'Date unknown'}
                </span>
                <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-all" />
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
