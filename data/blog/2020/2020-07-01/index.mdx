---
template: post
title: "Access token vs Refresh token"
slug: access-token-vs-refresh-token
date: "2020-07-01"
category: feathers
tags: ["refresh-token", "jwt", "access token"]
---

Recently in one of my project I need to secure my REST API using JWT. Most of my previous projects were using serverless architecture and I always use AWS Cognito as a go-to solution.

When working with AWS Cognito, we need to deal with three tokens: ID token, access token and refresh token. [Using Tokens with User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html). AWS SDK and Amplify handle all the dirty-works related to token management, and provides couple APIs that enables easy and straight forward interface working with Cognito backend.

When I come to use Feathers as a building block for my new project, I bring the same expectation for Feathers. I was really surprised when I learned that Feathers only supports access token and no refresh token implementation.

Refresh-token actually is long-requested feature for Feathers since year 2015. [Add support for refresh tokens #1337](https://github.com/feathersjs/feathers/issues/1337#issuecomment-651488662) After digging into the discussions in the issue, I found that there were some mis-understandings of refresh-token. Some people believe that re-issuing access-token is refresh-token. That's not the case. Access token and refresh token are two totally different things.

I list some key difference below:

### Difference between access token and refresh token

|                          | Access Token        | Refresh Token        |
| ------------------------ | ------------------- | -------------------- |
| State                    | Stateless           | Stateful             |
| Revokable                | No                  | Yes                  |
| Validity                 | Short(mintues)      | Long (days or month) |
| Require persistent store | No                  | yes                  |
| Usage                    | Access resource API | Renew access token   |
