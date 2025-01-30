import { UserConfig } from "./config";
import { SortTime, SortType } from "./types";

export interface RuntimeConfig extends UserConfig {
  subredditList: string[];
  numberOfPosts: number;
  sorting: SortType;
  time: SortTime;
  searchType: "post" | "comment";
  repeatForever: boolean;
  timeBetweenRuns: number;
  downloadDirectory?: string;
}
