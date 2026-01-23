import { TIMEOUT_MS } from "@/utils/constants";

export async function getTwitterName(username: string) {
  try {
    const baseUrl = "https://api.twitterapi.io/twitter/user/search";

    const url = new URL(baseUrl);
    url.searchParams.append("query", username);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-Key": Bun.env.TWITTER_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const name = data.users[0].name;
    return name;
  } catch (error) {
    console.error("Error fetching Twitter details:", error);
    return null;
  }
}

export async function getTwitterFollowersName(username: string) {
  const baseUrl = "https://api.twitterapi.io/twitter/user/followers";
  const allFollowers: string[] = [];
  let cursor = "";
  let hasNextPage = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    while (hasNextPage) {
      const url = new URL(baseUrl);
      url.searchParams.append("userName", username);
      url.searchParams.append("cursor", cursor);
      url.searchParams.append("pageSize", "100");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": Bun.env.TWITTER_API_KEY,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const names = (data.followers || []).map(
        (user: { name: string }) => user.name
      );
      allFollowers.push(...names);
      hasNextPage = data.has_next_page;
      cursor = data.next_cursor;
    }

    return allFollowers;
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.warn(`getTwitterFollowersName timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.error("Error fetching Twitter followers:", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
