// ABOUTME: Declares the hosted-git-info module for the package skill resolver.
// ABOUTME: The runtime package is unchanged by this file.
declare module "hosted-git-info" {
  interface HostedGitInfo {
    project?: string;
    domain?: string;
    user?: string;
    committish?: string;
    https(): string;
  }
  const hostedGitInfo: {
    fromUrl(url: string): HostedGitInfo | undefined;
  };
  export default hostedGitInfo;
}
