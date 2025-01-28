import { ApiService } from "./ApiService";
import { JSONcomment, CSVComment, PostComments } from "../types/output";
import { LogService } from "./LogService";
import { formatCommentsAsTree } from "../utils/commentTree";
import { RedditPost } from "types/types";
import { ConfigService } from "./ConfigService";

export class CommentService {
  private logger: LogService;
  private configService: ConfigService;
  private apiService: ApiService;

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.logger = configService.getLogger();
    this.apiService = new ApiService(this.logger);
  }

  public async fetchAndFormatComments(postPermalink: string, post: RedditPost): Promise<string | null> {
    const config = this.configService.getRuntimeConfig();
    if (!config.download_comments) {
      return null;
    }

    try {
      const postUrl = `https://www.reddit.com${postPermalink}.json`;
      const data = await this.apiService.get<[any, any]>(postUrl);
      const comments = data[1].data.children;

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
      switch (config.file_format_options.comment_format) {
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
      this.logger.log(
        `Failed to fetch comments for post: ${
          err.response?.status === 429
            ? "Rate limit exceeded."
            : err.response?.status >= 500
            ? "Reddit server error."
            : err.message || "Unknown error"
        }`,
        true
      );
      return null;
    }
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
