import { ResyClient } from "./src/sdk";

const client = new ResyClient({
    authToken: process.env.RESY_AUTH_TOKEN,
    apiKey: process.env.RESY_API_KEY,
});

async function debug() {
    const venueId = 76033;
    const partySize = 2;
    const day = "2026-02-04";

    try {
        const result = await client.findSlots({
            venue_id: venueId,
            day,
            party_size: partySize,
        });

        const venue = result.results?.venues?.[0];
        const slots = venue?.slots ?? [];

        console.log(`Found ${slots.length} slots\n`);

        // Show the first few slots' date format
        for (const slot of slots.slice(0, 5)) {
            console.log("Slot date object:", JSON.stringify(slot.date));
            console.log("  start:", slot.date?.start);
            console.log("  end:", slot.date?.end);
            console.log("");
        }
    } catch (error: any) {
        console.error("Error:", error.message);
    }
}

debug();
