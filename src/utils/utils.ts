export const cleanSubreddits = (subreddits: string[]): string[] => 
    subreddits.map((name) => name.replace(/[^a-zA-Z0-9?+]/g, ""));