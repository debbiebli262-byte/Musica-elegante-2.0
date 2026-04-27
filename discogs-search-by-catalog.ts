import type { VercelRequest, VercelResponse } from "@vercel/node";

type DiscogsArtist = {
  name?: string;
};

type DiscogsLabel = {
  name?: string;
  catno?: string;
};

type DiscogsExtraArtist = {
  name?: string;
  role?: string;
};

type DiscogsTrack = {
  position?: string;
  title?: string;
  duration?: string;
  type_?: string;
  extraartists?: DiscogsExtraArtist[];
  sub_tracks?: DiscogsTrack[];
};

type AppMovement = {
  trackNumber: number;
  title: string;
  duration: string;
};

type AppWork = {
  title: string;
  movements: AppMovement[];
};

type AppDisc = {
  discNumber: number;
  title?: string;
  works: AppWork[];
};

type AppTrack = {
  trackNumber: number;
  discNumber?: number;
  title: string;
  duration: string;
};

function flattenDiscogsTracklist(tracklist: DiscogsTrack[] = []): DiscogsTrack[] {
  const result: DiscogsTrack[] = [];

  for (const item of tracklist) {
    if (!item) continue;

    result.push(item);

    if (Array.isArray(item.sub_tracks) && item.sub_tracks.length > 0) {
      for (const sub of item.sub_tracks) {
        result.push({
          ...sub,
          position: sub.position || item.position || "",
        });
      }
    }
  }

  return result;
}

function getDiscNumberFromPosition(position?: string): number {
  if (!position) return 1;

  const trimmed = position.trim();
  const match = trimmed.match(/(\d+)\s*[-.]/) || trimmed.match(/CD\s*(\d+)/i);

  if (match?.[1]) {
    const discNumber = parseInt(match[1], 10);
    return Number.isNaN(discNumber) ? 1 : discNumber;
  }

  return 1;
}

function getTrackNumberFromPosition(position?: string, fallback = 1): number {
  if (!position) return fallback;

  const trimmed = position.trim();
  const match = trimmed.match(/(?:\d+\s*[-.])\s*(\d+)/);

  if (match?.[1]) {
    const trackNumber = parseInt(match[1], 10);
    return Number.isNaN(trackNumber) ? fallback : trackNumber;
  }

  const vinylMatch = trimmed.match(/[A-Z]\s*(\d+)/i);
  if (vinylMatch?.[1]) {
    const trackNumber = parseInt(vinylMatch[1], 10);
    return Number.isNaN(trackNumber) ? fallback : trackNumber;
  }

  return fallback;
}

function isHeadingTrack(item: DiscogsTrack): boolean {
  return item.type_ === "heading";
}

function isPlayableTrack(item: DiscogsTrack): boolean {
  return Boolean(item.title) && item.type_ !== "heading";
}

function buildClassicalDiscs(tracklist: DiscogsTrack[]): AppDisc[] {
  const discsMap = new Map<number, AppDisc>();
  const movementCounters = new Map<string, number>();

  let pendingWorkTitle = "";
  let fallbackWorkTitle = "Tracklist";

  for (const item of tracklist) {
    if (isHeadingTrack(item)) {
      pendingWorkTitle = item.title?.trim() || "";
      continue;
    }

    if (!isPlayableTrack(item)) continue;

    const discNumber = getDiscNumberFromPosition(item.position);
    const discKey = String(discNumber);

    if (!discsMap.has(discNumber)) {
      discsMap.set(discNumber, {
        discNumber,
        works: [],
      });
    }

    const disc = discsMap.get(discNumber)!;
    const workTitle = pendingWorkTitle || fallbackWorkTitle;

    let work = disc.works.find((w) => w.title === workTitle);
    if (!work) {
      work = {
        title: workTitle,
        movements: [],
      };
      disc.works.push(work);
    }

    const counterKey = `${discKey}__${workTitle}`;
    const nextMovementNumber = (movementCounters.get(counterKey) || 0) + 1;
    movementCounters.set(counterKey, nextMovementNumber);

    work.movements.push({
      trackNumber: nextMovementNumber,
      title: item.title?.trim() || "",
      duration: item.duration?.trim() || "",
    });

    fallbackWorkTitle = workTitle;
  }

  return Array.from(discsMap.values()).sort((a, b) => a.discNumber - b.discNumber);
}

function buildJazzTracks(tracklist: DiscogsTrack[]): AppTrack[] {
  let fallbackCounter = 1;

  return tracklist
    .filter(isPlayableTrack)
    .map((item) => {
      const track = {
        trackNumber: getTrackNumberFromPosition(item.position, fallbackCounter),
        discNumber: getDiscNumberFromPosition(item.position),
        title: item.title?.trim() || "",
        duration: item.duration?.trim() || "",
      };

      fallbackCounter += 1;
      return track;
    });
}

function uniqueText(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").replace(/\s*\(\d+\)$/, "").trim())
        .filter(Boolean)
    )
  ).join(", ");
}

function findExtraArtistNames(extraartists: DiscogsExtraArtist[] = [], roleKeywords: string[]) {
  return uniqueText(
    extraartists
      .filter((artist) =>
        roleKeywords.some((keyword) => String(artist.role || "").toLowerCase().includes(keyword))
      )
      .map((artist) => artist.name)
  );
}

function findComposers(extraartists: DiscogsExtraArtist[] = []) {
  return Array.from(
    new Set(
      extraartists
        .filter((artist) =>
          String(artist.role || "").toLowerCase().includes("composed")
        )
        .map((artist) =>
          String(artist.name || "").replace(/\s*\(\d+\)$/, "").trim()
        )
        .filter(Boolean)
    )
  );
}

function guessDiscCount(releaseData: any, found: any) {
  const descriptions = [
    ...(Array.isArray(found?.format) ? found.format : []),
    ...(Array.isArray(releaseData?.formats)
      ? releaseData.formats.flatMap((format: any) => [
          format?.name,
          ...(Array.isArray(format?.descriptions) ? format.descriptions : []),
          format?.qty,
        ])
      : []),
  ]
    .filter(Boolean)
    .map((value) => String(value));

  for (const item of descriptions) {
    const qtyMatch = item.match(/^(\d+)\s*x\s*/i);
    if (qtyMatch?.[1]) {
      const qty = parseInt(qtyMatch[1], 10);
      if (!Number.isNaN(qty) && qty > 0) return qty;
    }
  }

  const qty = releaseData?.formats?.[0]?.qty;
  if (qty) {
    const parsed = parseInt(String(qty), 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  return 1;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const rawCatno = String(req.query.catno || "").trim();

    if (!rawCatno) {
      return res.status(400).json({ error: "Catalog number is required" });
    }

    const token = process.env.DISCOGS_TOKEN;
    const userAgent = process.env.DISCOGS_USER_AGENT || "MusicaElegante/1.0";

    if (!token) {
      return res.status(500).json({ error: "DISCOGS_TOKEN is missing" });
    }

    const cleanedNoSpaces = rawCatno.replace(/[-\s]/g, "");
    
    const spacedBarcode =
      cleanedNoSpaces.length === 12
        ? `${cleanedNoSpaces[0]} ${cleanedNoSpaces.slice(1, 6)} ${cleanedNoSpaces.slice(6, 11)} ${cleanedNoSpaces.slice(11)}`
        : "";

    const searchAttempts = [
      { key: "barcode", value: rawCatno },
      { key: "barcode", value: cleanedNoSpaces },
      { key: "barcode", value: spacedBarcode },
      { key: "q", value: rawCatno },
      { key: "q", value: cleanedNoSpaces },
      { key: "q", value: spacedBarcode },
      { key: "catno", value: rawCatno },
      { key: "catno", value: rawCatno.replace(/-/g, "") },
      { key: "catno", value: rawCatno.replace(/\s+/g, "") },
    ].filter((attempt, index, all) =>
      attempt.value &&
      all.findIndex((other) => other.key === attempt.key && other.value === attempt.value) === index
    );

    let found: any = null;

    for (const attempt of searchAttempts) {
      const searchUrl = new URL("https://api.discogs.com/database/search");
      searchUrl.searchParams.set(attempt.key, attempt.value);
      searchUrl.searchParams.set("type", "release");
      searchUrl.searchParams.set("per_page", "10");

      const response = await fetch(searchUrl.toString(), {
        headers: {
          "User-Agent": userAgent,
          "Authorization": `Discogs token=${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Discogs search error:", text);
        continue;
      }

      const data = await response.json();

      if (data.results?.length) {
        found = data.results[0];
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ error: "No Discogs release found" });
    }

    const releaseUrl =
      found.resource_url ||
      (found.id ? `https://api.discogs.com/releases/${found.id}` : "");

    let releaseData: any = null;

    if (releaseUrl) {
      const releaseResponse = await fetch(releaseUrl, {
        headers: {
          "User-Agent": userAgent,
          "Authorization": `Discogs token=${token}`,
        },
      });

      if (releaseResponse.ok) {
        releaseData = await releaseResponse.json();
      } else {
        const text = await releaseResponse.text();
        console.error("Discogs release error:", text);
      }
    }

    const rawTracklist = flattenDiscogsTracklist(releaseData?.tracklist || []);
    const genres = releaseData?.genres || found.genre || [];
    const styles = releaseData?.styles || found.style || [];

    const genreList = Array.isArray(genres) ? genres : [genres].filter(Boolean);
    const styleList = Array.isArray(styles) ? styles : [styles].filter(Boolean);

    const isClassical = [...genreList, ...styleList].some((item) =>
      String(item).toLowerCase().includes("class")
    );

    const tracks = isClassical ? [] : buildJazzTracks(rawTracklist);
    const discs = isClassical ? buildClassicalDiscs(rawTracklist) : [];

    const albumLevelExtraArtists = Array.isArray(releaseData?.extraartists) ? releaseData.extraartists : [];
    const trackLevelExtraArtists = rawTracklist.flatMap((track) =>
      Array.isArray(track.extraartists) ? track.extraartists : []
    );
    
    const combinedExtraArtists = [...albumLevelExtraArtists, ...trackLevelExtraArtists];
    const composers = findComposers(combinedExtraArtists);

    const artist =
      Array.isArray(releaseData?.artists) && releaseData.artists.length > 0
        ? releaseData.artists.map((a: DiscogsArtist) => a.name).filter(Boolean).join(", ")
        : "";

    const labelNames = Array.isArray(releaseData?.labels)
      ? releaseData.labels.map((l: DiscogsLabel) => l.name).filter(Boolean).join(", ")
      : Array.isArray(found.label)
        ? found.label.join(", ")
        : "";

    const mainCatno =
      releaseData?.labels?.[0]?.catno ||
      found.catno ||
      "";

    return res.status(200).json({
      title: releaseData?.title || found.title || "",
      artist,
      year: releaseData?.year || found.year || "",
      country: releaseData?.country || found.country || "",
      format: Array.isArray(found.format) ? found.format.join(", ") : "",
      label: labelNames,
      catno: mainCatno,
      thumb: found.thumb || "",
      coverImage: releaseData?.images?.[0]?.uri || found.cover_image || "",
      discogsUrl: found.uri ? `https://www.discogs.com${found.uri}` : "",
      genres: genreList,
      styles: styleList,
      discCount: guessDiscCount(releaseData, found),
      composers,
      orchestra: findExtraArtistNames(combinedExtraArtists, ["orchestra"]),
      conductor: findExtraArtistNames(combinedExtraArtists, ["conductor", "directed by", "director"]),
      producer: findExtraArtistNames(combinedExtraArtists, ["producer", "produced by"]),
      engineer: findExtraArtistNames(combinedExtraArtists, ["engineer", "recorded by", "recording engineer"]),
      masteringEngineer: findExtraArtistNames(combinedExtraArtists, ["mastered by", "mastering"]),
      originalLabel: labelNames,
      originalCatalogNumber: mainCatno,
      originalYear: releaseData?.year || found.year || "",
      rawTracklist,
      tracks,
      discs,
      raw: releaseData || found,
    });
  } catch (error) {
    console.error("Discogs catalog search error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected Discogs error",
    });
  }
}