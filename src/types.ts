export interface Library {
  id: string;
  name: string;
  type: string;
}

export interface LibraryStats {
  totalItems: number;
  totalAuthors: number;
  totalDuration: number;
  recentItems: Book[];
}

export interface Book {
  id: string;
  libraryId: string;
  metadata: {
    title: string;
    authorName: string;
    coverPath?: string;
  };
  addedAt: number;
  duration?: number;
}

export interface User {
  id: string;
  username: string;
  type: string;
}

export interface Session {
  id: string;
  userId: string;
  username: string;
  libraryId: string;
  libraryItemId?: string;
  duration: number;
  timeListening: number;
  startedAt: number;
  updatedAt?: number;
  currentTime?: number;
  progress?: number;
  isActive?: boolean;
  displayTitle?: string;
  mediaItemTitle?: string;
  user?: {
    id?: string;
    username: string;
  };
}

export interface UserStats {
  userId: string;
  username: string;
  totalTime: number;
  avgDaily: number;
  activity: Record<string, number>; // date string -> seconds
  joinedAt: number;
  preferredTime: string;
  completionRate: number;
  deviceUsage: string;
  topGenre: string;
}

export interface MatchCandidate {
  title: string;
  author?: string;
  coverUrl?: string;
  asin?: string;
  isbn?: string;
  subtitle?: string;
  publisher?: string;
  publishDate?: string;
  description?: string;
  provider: string;
  id: string;
}

