import React, { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

interface CoverImageProps {
  itemId: string;
  title?: string;
  className?: string;
}

export function CoverImage({ itemId, title, className }: CoverImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(false);

    api.fetchCoverAsBlob(itemId)
      .then((url) => {
        if (!active) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (url) {
          objectUrl = url;
          setSrc(url);
          setLoading(false);
        } else {
          setError(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Cover image load error:", err);
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [itemId]);

  if (loading) {
    return (
      <div
        className={cn(
          "bg-slate-200 animate-pulse flex items-center justify-center rounded-md w-full h-full border border-slate-200/50 shadow-inner",
          className
        )}
      >
        <BookOpen className="text-slate-400/60 animate-bounce" size={24} />
      </div>
    );
  }

  if (error || !src) {
    return (
      <div
        className={cn(
          "bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-3 text-center border border-slate-300/40 shadow-inner rounded-md w-full h-full",
          className
        )}
      >
        <BookOpen className="text-slate-400 mb-1" size={28} />
        {title ? (
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider line-clamp-2 max-w-[85%] leading-normal">
            {title}
          </span>
        ) : (
          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
            No Cover
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title || "Book Cover"}
      className={cn(
        "object-cover transition-all duration-300 ease-out hover:scale-[1.02]",
        className
      )}
      onError={() => setError(true)}
    />
  );
}
