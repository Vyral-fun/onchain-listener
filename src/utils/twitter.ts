import { sleep } from "bun";

export async function getTwitterName(username: string) {
  try {
    const baseUrl = "https://api.twitterapi.io/twitter/user/search";

    const url = new URL(baseUrl);
    url.searchParams.append("query", username);

    console.log("Request URL:", url.toString());
    console.log("API Key present:", !!Bun.env.TWITTER_API_KEY);
    console.log("API Key length:", Bun.env.TWITTER_API_KEY?.length);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-Key": Bun.env.TWITTER_API_KEY,
      },
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const name = data.users[0].name;
    console.log("Extracted name:", name);
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
  try {
    while (hasNextPage) {
      const url = new URL(baseUrl);
      url.searchParams.append("userName", username);
      url.searchParams.append("cursor", cursor);
      url.searchParams.append("pageSize", "200");

      console.log("Request URL:", url.toString());
      console.log("API Key present:", !!Bun.env.TWITTER_API_KEY);
      console.log("API Key length:", Bun.env.TWITTER_API_KEY?.length);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": Bun.env.TWITTER_API_KEY,
        },
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const names = (data.followers || []).map(
        (user: { name: string }) => user.name
      );
      allFollowers.push(...names);
      console.log(
        `Fetched ${names.length} followers, total so far: ${allFollowers.length}`
      );

      hasNextPage = data.has_next_page;
      cursor = data.next_cursor;

      if (hasNextPage) {
        console.log("Waiting 5s before next page...");
        // await sleep(5000);
      }
    }

    console.log(`Total followers fetched: ${allFollowers.length}`);
    console.log("Extracted follower names:", allFollowers);
    return allFollowers;
  } catch (error) {
    console.error("Error fetching Twitter followers:", error);
    return [];
  }
}
