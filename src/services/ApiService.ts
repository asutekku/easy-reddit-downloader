import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { LogService } from './LogService';
import { UserAgentService } from './UserAgentService';

interface RetryConfig {
  maxRetries?: number;
  initialRetryDelay?: number;
  postDelayMilliseconds?: number;
}

export class ApiService {
  private logger: LogService;
  private maxRetries: number = 5;
  private initialRetryDelay: number = 5000;
  private postDelayMilliseconds: number = 1000;

  constructor(logger: LogService, config?: RetryConfig) {
    this.logger = logger;
    if (config) {
      this.maxRetries = config.maxRetries ?? this.maxRetries;
      this.initialRetryDelay = config.initialRetryDelay ?? this.initialRetryDelay;
      this.postDelayMilliseconds = config.postDelayMilliseconds ?? this.postDelayMilliseconds;
    }
  }

  public async get<T>(url: string, customConfig?: AxiosRequestConfig): Promise<T> {
    let retryCount = 0;
    let delay = this.initialRetryDelay;

    while (retryCount <= this.maxRetries) {
      try {
        const config = {
          ...UserAgentService.getAxiosConfig(),
          ...customConfig
        };

        this.logger.log(`\n\n👀 Requesting from ${url}\n`, true);
        const response: AxiosResponse<T> = await axios.get(url, config);

        // Sleep after successful fetch to respect rate limits
        await this.sleep();

        return response.data;
      } catch (err: any) {
        const isLastAttempt = retryCount === this.maxRetries;
        const isRateLimitError = err.response?.status === 429;
        const isServerError = err.response?.status >= 500;
        
        if (!isLastAttempt && (isRateLimitError || isServerError || err.code === 'ECONNRESET')) {
          const reason = isRateLimitError ? 'Rate limit exceeded (429)'
            : isServerError ? `Server error (${err.response?.status})`
            : err.code === 'ECONNRESET' ? 'Connection reset'
            : 'Unknown error';
            
          this.logger.log(
            `\n⚠️ Attempt ${retryCount + 1}/${this.maxRetries + 1} failed due to: ${reason}. Retrying in ${delay/1000} seconds...`,
            true
          );
          
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          delay *= 2; // Exponential backoff
          continue;
        }

        this.logger.logError(
          `\n\nERROR: Request failed for ${url}. ${
            isRateLimitError ? 'Rate limit exceeded.' :
            isServerError ? 'Server error.' :
            err.message || 'Unknown error'
          }`
        );
        throw err;
      }
    }
    throw new Error(`Failed after ${this.maxRetries} retries`);
  }

  public async downloadStream(url: string, customConfig?: AxiosRequestConfig): Promise<NodeJS.ReadableStream> {
    let retryCount = 0;
    let delay = this.initialRetryDelay;

    while (retryCount <= this.maxRetries) {
      try {
        const config = {
          ...UserAgentService.getAxiosConfig(),
          ...customConfig,
          responseType: 'stream' as const
        };

        this.logger.log(`\n\n👀 Downloading stream from ${url}\n`, true);
        const response = await axios.get(url, config);

        return response.data;
      } catch (err: any) {
        const isLastAttempt = retryCount === this.maxRetries;
        const isRateLimitError = err.response?.status === 429;
        const isServerError = err.response?.status >= 500;
        const isConnectionError = err.code === 'ECONNRESET' || err.code === 'ENOTFOUND';
        
        if (!isLastAttempt && (isRateLimitError || isServerError || isConnectionError)) {
          const reason = isRateLimitError ? 'Rate limit exceeded (429)'
            : isServerError ? `Server error (${err.response?.status})`
            : err.code === 'ECONNRESET' ? 'Connection reset'
            : err.code === 'ENOTFOUND' ? 'Host not found'
            : 'Unknown error';
            
          this.logger.log(
            `\n⚠️ Download attempt ${retryCount + 1}/${this.maxRetries + 1} failed due to: ${reason}. Retrying in ${delay/1000} seconds...`,
            true
          );
          
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          delay *= 2; // Exponential backoff
          continue;
        }

        this.logger.logError(
          `\n\nERROR: Stream download failed for ${url}. ${
            isRateLimitError ? 'Rate limit exceeded.' :
            isServerError ? 'Server error.' :
            err.code === 'ENOTFOUND' ? 'Host not found.' :
            err.message || 'Unknown error'
          }`
        );
        throw err;
      }
    }
    throw new Error(`Failed to download stream after ${this.maxRetries} retries`);
  }

  private async sleep(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.postDelayMilliseconds));
  }
}
