import axios from "axios";
import { UserAgentService } from "./UserAgentService";
import { JSONcomment, CSVComment, PostComments } from "../types/output";
import { LogService } from "./LogService";
import { RuntimeConfig } from "../types/runtime";
import { formatCommentsAsTree } from "../utils/commentTree";
import { RedditPost } from "types/types";

export class CommentService {
  private logger: LogService;
  private config: RuntimeConfig;
  private maxRetries: number = 3;
  private initialRetryDelay: number = 1000;
  private postDelayMilliseconds: number = 250;

  constructor(config: RuntimeConfig, logger: LogService) {
    this.config = config;
    this.logger = logger;
  }

  public async fetchAndFormatComments(postPermalink: string, post: RedditPost): Promise<string | null> {
    if (!this.config.download_comments) {
      return null;
    }

    const postUrl = `https://www.reddit.com${postPermalink}.json`;
    let retryCount = 0;
    let delay = this.initialRetryDelay;

    while (retryCount <= this.maxRetries) {
      try {
        const response = await axios.get(postUrl, UserAgentService.getAxiosConfig());
        const comments = response.data[1].data.children;

        // Sleep after successful fetch to respect rate limits
        await new Promise(resolve => setTimeout(resolve, this.postDelayMilliseconds));

        let OriginalData: JSONcomment = {
          user: post.author,
          comment: `${post.title} | ${post.selftext !== "" ? post.selftext! : ""}`,
          votes: post.score,
          child: [],
        };

        // First convert to our base JSON format
        const jsonComments = this.convertToJsonFormat(comments);
        OriginalData.child = jsonComments;

        // Then convert to the specified format based on config
        switch (this.config.file_format_options.comment_format) {
          case "json":
            return JSON.stringify([OriginalData], null, 2);
          case "csv":
            return this.convertToCSV([OriginalData]);
          case "txt":
            return this.convertToTxt([OriginalData]);
          default:
            return JSON.stringify([OriginalData], null, 2);
        }
      } catch (err: any) {
        const isLastAttempt = retryCount === this.maxRetries;
        const isRateLimitError = err.response?.status === 429;
        const isServerError = err.response?.status >= 500;
        
        if (!isLastAttempt && (isRateLimitError || isServerError || err.code === 'ECONNRESET')) {
          this.logger.log(
            `\n⚠️ Attempt ${retryCount + 1}/${this.maxRetries + 1} failed to fetch comments. Retrying in ${delay/1000} seconds...`,
            true
          );
          
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          delay *= 2; // Exponential backoff
          continue;
        }

        this.logger.log(
          `Failed to fetch comments for post: ${
            isRateLimitError ? 'Rate limit exceeded.' :
            isServerError ? 'Reddit server error.' :
            err.message || 'Unknown error'
          }`,
          true
        );
        return null;
      }
    }
    return null;
  }

  private convertToJsonFormat(comments: any[]): PostComments {
    return comments.map(({ data: comment }) => this.processCommentToJson(comment));
  }

  private processCommentToJson(comment: any): JSONcomment {
    const jsonComment: JSONcomment = {
      user: comment.author,
      comment: comment.body,
      votes: comment.score,
      child: [],
    };

    if (comment.replies && typeof comment.replies !== "string") {
      jsonComment.child = comment.replies.data.children.map((child: any) => this.processCommentToJson(child.data));
    }

    return jsonComment;
  }

  private convertToCSV(comments: PostComments): string {
    const csvComments: CSVComment[] = [];
    const header = "user|comment_id|comment|votes|parent\n";

    const processComment = (comment: JSONcomment, parentId: string | null = null) => {
      const commentId = Math.random().toString(36).substring(2, 8); // Simple ID generation
      csvComments.push({
        user: comment.user,
        comment_id: commentId,
        comment: comment.comment.replace(/\\n/g, " ").replace(/\|/g, ","),
        votes: comment.votes,
        parent: parentId,
      });

      comment.child.forEach((childComment) => {
        processComment(childComment, commentId);
      });
    };

    comments.forEach((comment) => processComment(comment));

    return header + csvComments.map((c) => `${c.user}|${c.comment_id}|${c.comment}|${c.votes}|${c.parent || "null"}`).join("\n");
  }

  private convertToTxt(comments: PostComments): string {
    return formatCommentsAsTree(comments);
  }
}
