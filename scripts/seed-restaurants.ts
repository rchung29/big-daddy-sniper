/**
 * Seed script for populating the restaurant library
 *
 * Run with: bun scripts/seed-restaurants.ts
 *
 * Data sourced from NYC RSVPs list - RESY RESTAURANTS ONLY
 * Skipped: Din Tai Fung (Yelp), Don Angie (OpenTable), Gage & Tollner (OpenTable),
 *          Hillstone (Own Site), Per Se (Tock), Polo Bar (Phone), Roscioli (OpenTable),
 *          The Corner Store (Own Site), Una Pizza Napoletana (OpenTable), Zou Zou's (OpenTable)
 */
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

interface RestaurantData {
  venue_id: string;
  name: string;
  neighborhood: string;
  cuisine: string;
  days_in_advance: number;
  release_time: string; // HH:mm format (24h)
}

/**
 * 43 Resy restaurants from NYC RSVPs list
 * NOTE: venue_id values are PLACEHOLDERS - need to be verified against Resy API
 */
const RESTAURANTS: RestaurantData[] = [
  // ============ 7:00 AM releases ============
  {
    venue_id: "FOUR_HORSEMEN", // TODO: Get real ID
    name: "The Four Horsemen",
    neighborhood: "Williamsburg",
    cuisine: "Wine Bar",
    days_in_advance: 29,
    release_time: "07:00",
  },

  // ============ 8:00 AM releases ============
  {
    venue_id: "RAOULS", // TODO: Get real ID
    name: "Raoul's",
    neighborhood: "Greenwich Village",
    cuisine: "French",
    days_in_advance: 30,
    release_time: "08:00",
  },
  {
    venue_id: "WAVERLY_INN", // TODO: Get real ID
    name: "Waverly Inn",
    neighborhood: "West Village",
    cuisine: "American",
    days_in_advance: 14,
    release_time: "08:00",
  },

  // ============ 9:00 AM releases ============
  {
    venue_id: "4_CHARLES", // TODO: Get real ID
    name: "4 Charles Prime Rib",
    neighborhood: "West Village",
    cuisine: "Steakhouse",
    days_in_advance: 20,
    release_time: "09:00",
  },
  {
    venue_id: "ADDA", // TODO: Get real ID
    name: "Adda",
    neighborhood: "East Village",
    cuisine: "Indian",
    days_in_advance: 6,
    release_time: "09:00",
  },
  {
    venue_id: "AU_CHEVAL", // TODO: Get real ID
    name: "Au Cheval",
    neighborhood: "Tribeca",
    cuisine: "American",
    days_in_advance: 20,
    release_time: "09:00",
  },
  {
    venue_id: "CORNER_BAR", // TODO: Get real ID
    name: "Corner Bar",
    neighborhood: "Lower East Side",
    cuisine: "American",
    days_in_advance: 27,
    release_time: "09:00",
  },
  {
    venue_id: "DHAMAKA", // TODO: Get real ID
    name: "Dhamaka",
    neighborhood: "Lower East Side",
    cuisine: "Indian",
    days_in_advance: 14,
    release_time: "09:00",
  },
  {
    venue_id: "LARTUSI", // TODO: Get real ID
    name: "L'Artusi",
    neighborhood: "West Village",
    cuisine: "Italian",
    days_in_advance: 14,
    release_time: "09:00",
  },
  {
    venue_id: "MONKEY_BAR", // TODO: Get real ID
    name: "Monkey Bar",
    neighborhood: "Midtown East",
    cuisine: "American",
    days_in_advance: 20,
    release_time: "09:00",
  },
  {
    venue_id: "SEMMA", // TODO: Get real ID
    name: "Semma",
    neighborhood: "Greenwich Village",
    cuisine: "South Indian",
    days_in_advance: 14,
    release_time: "09:00",
  },
  {
    venue_id: "THEODORA", // TODO: Get real ID
    name: "Theodora",
    neighborhood: "Fort Greene",
    cuisine: "Mediterranean",
    days_in_advance: 30,
    release_time: "09:00",
  },

  // ============ 10:00 AM releases ============
  {
    venue_id: "BONNIES", // TODO: Get real ID
    name: "Bonnie's",
    neighborhood: "Williamsburg",
    cuisine: "Cantonese",
    days_in_advance: 13,
    release_time: "10:00",
  },
  {
    venue_id: "BUVETTE", // TODO: Get real ID
    name: "Buvette",
    neighborhood: "West Village",
    cuisine: "French",
    days_in_advance: 13,
    release_time: "10:00",
  },
  {
    venue_id: "CARBONE", // TODO: Get real ID
    name: "Carbone",
    neighborhood: "Greenwich Village",
    cuisine: "Italian",
    days_in_advance: 30,
    release_time: "10:00",
  },
  {
    venue_id: "COTE", // TODO: Get real ID
    name: "Cote",
    neighborhood: "Chelsea",
    cuisine: "Korean",
    days_in_advance: 29,
    release_time: "10:00",
  },
  {
    venue_id: "EMP", // TODO: Get real ID
    name: "Eleven Madison Park",
    neighborhood: "Flatiron",
    cuisine: "New American",
    days_in_advance: 30, // Note: Actually 1st of prev month, using 30 as approximation
    release_time: "10:00",
  },
  {
    venue_id: "LASER_WOLF", // TODO: Get real ID
    name: "Laser Wolf",
    neighborhood: "Williamsburg",
    cuisine: "Israeli",
    days_in_advance: 21,
    release_time: "10:00",
  },
  {
    venue_id: "LILIA", // TODO: Get real ID
    name: "Lilia",
    neighborhood: "Williamsburg",
    cuisine: "Italian",
    days_in_advance: 28,
    release_time: "10:00",
  },
  {
    venue_id: "MISI", // TODO: Get real ID
    name: "Misi",
    neighborhood: "Williamsburg",
    cuisine: "Italian",
    days_in_advance: 27,
    release_time: "10:00",
  },
  {
    venue_id: "SADELLES", // TODO: Get real ID
    name: "Sadelle's",
    neighborhood: "Soho",
    cuisine: "Brunch",
    days_in_advance: 30,
    release_time: "10:00",
  },
  {
    venue_id: "TORRISI", // TODO: Get real ID
    name: "Torrisi Bar & Restaurant",
    neighborhood: "Nolita",
    cuisine: "Italian",
    days_in_advance: 30,
    release_time: "10:00",
  },
  {
    venue_id: "VIA_CAROTA", // TODO: Get real ID
    name: "Via Carota",
    neighborhood: "West Village",
    cuisine: "Italian",
    days_in_advance: 30,
    release_time: "10:00",
  },

  // ============ 11:00 AM releases ============
  {
    venue_id: "BUNGALOW", // TODO: Get real ID
    name: "Bungalow",
    neighborhood: "East Village",
    cuisine: "Indian",
    days_in_advance: 20,
    release_time: "11:00",
  },

  // ============ 12:00 PM (Noon) releases ============
  {
    venue_id: "HAS_SNACK_BAR", // TODO: Get real ID
    name: "Ha's Snack Bar",
    neighborhood: "Lower East Side",
    cuisine: "Vietnamese",
    days_in_advance: 20,
    release_time: "12:00",
  },
  {
    venue_id: "TATIANA", // TODO: Get real ID
    name: "Tatiana",
    neighborhood: "Upper West Side",
    cuisine: "Afro-Caribbean",
    days_in_advance: 27,
    release_time: "12:00",
  },

  // ============ 12:00 AM (Midnight) releases ============
  {
    venue_id: "ATOBOY", // TODO: Get real ID
    name: "Atoboy",
    neighborhood: "NoMad",
    cuisine: "Korean",
    days_in_advance: 29,
    release_time: "00:00",
  },
  {
    venue_id: "BALTHAZAR", // TODO: Get real ID
    name: "Balthazar",
    neighborhood: "Soho",
    cuisine: "French",
    days_in_advance: 30,
    release_time: "00:00",
  },
  {
    venue_id: "BISTROT_HA", // TODO: Get real ID
    name: "Bistrot Ha",
    neighborhood: "Lower East Side",
    cuisine: "French Vietnamese",
    days_in_advance: 6,
    release_time: "00:00",
  },
  {
    venue_id: "CHINESE_TUXEDO", // TODO: Get real ID
    name: "Chinese Tuxedo",
    neighborhood: "Chinatown",
    cuisine: "Chinese",
    days_in_advance: 14,
    release_time: "00:00",
  },
  {
    venue_id: "CLAUD", // TODO: Get real ID
    name: "Claud",
    neighborhood: "East Village",
    cuisine: "European",
    days_in_advance: 15,
    release_time: "00:00",
  },
  {
    venue_id: "DCP", // TODO: Get real ID
    name: "Double Chicken Please",
    neighborhood: "Lower East Side",
    cuisine: "Cocktails / New American",
    days_in_advance: 6,
    release_time: "00:00",
  },
  {
    venue_id: "FISH_CHEEKS", // TODO: Get real ID
    name: "Fish Cheeks",
    neighborhood: "Nolita",
    cuisine: "Thai",
    days_in_advance: 29,
    release_time: "00:00",
  },
  {
    venue_id: "I_SODI", // TODO: Get real ID
    name: "i Sodi",
    neighborhood: "West Village",
    cuisine: "Italian",
    days_in_advance: 13,
    release_time: "00:00",
  },
  {
    venue_id: "LE_CAFE_LV", // TODO: Get real ID
    name: "Le Café Louis Vuitton",
    neighborhood: "Midtown East",
    cuisine: "French",
    days_in_advance: 27,
    release_time: "00:00",
  },
  {
    venue_id: "MASALAWALA", // TODO: Get real ID
    name: "Masalawala & Sons",
    neighborhood: "Park Slope",
    cuisine: "Indian",
    days_in_advance: 14,
    release_time: "00:00",
  },
  {
    venue_id: "PETER_LUGER", // TODO: Get real ID
    name: "Peter Luger",
    neighborhood: "Williamsburg",
    cuisine: "Steakhouse",
    days_in_advance: 30,
    release_time: "00:00",
  },
  {
    venue_id: "RED_HOOK_TAVERN", // TODO: Get real ID
    name: "Red Hook Tavern",
    neighborhood: "Red Hook",
    cuisine: "American",
    days_in_advance: 13,
    release_time: "00:00",
  },
  {
    venue_id: "REZDORA", // TODO: Get real ID
    name: "Rezdôra",
    neighborhood: "Flatiron",
    cuisine: "Italian",
    days_in_advance: 29,
    release_time: "00:00",
  },
  {
    venue_id: "RUBIROSA", // TODO: Get real ID
    name: "Rubirosa",
    neighborhood: "Nolita",
    cuisine: "Italian",
    days_in_advance: 7,
    release_time: "00:00",
  },
  {
    venue_id: "SHUKA", // TODO: Get real ID
    name: "Shuka",
    neighborhood: "Soho",
    cuisine: "Mediterranean",
    days_in_advance: 29,
    release_time: "00:00",
  },
  {
    venue_id: "SUSHI_NAKAZAWA", // TODO: Get real ID
    name: "Sushi Nakazawa",
    neighborhood: "West Village",
    cuisine: "Sushi",
    days_in_advance: 14,
    release_time: "00:00",
  },
  {
    venue_id: "THAI_DINER", // TODO: Get real ID
    name: "Thai Diner",
    neighborhood: "Nolita",
    cuisine: "Thai",
    days_in_advance: 29,
    release_time: "00:00",
  },
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  logger.info("Starting restaurant seed...");
  logger.info({ count: RESTAURANTS.length }, "Seeding restaurants...");

  let created = 0;
  let updated = 0;

  for (const restaurant of RESTAURANTS) {
    try {
      // Check if exists
      const { data: existing } = await supabase
        .from("restaurants")
        .select("id")
        .eq("venue_id", restaurant.venue_id)
        .single();

      if (existing) {
        // Update
        const { error } = await supabase
          .from("restaurants")
          .update({
            name: restaurant.name,
            neighborhood: restaurant.neighborhood,
            cuisine: restaurant.cuisine,
            days_in_advance: restaurant.days_in_advance,
            release_time: restaurant.release_time,
            release_time_zone: "America/New_York",
            enabled: true,
          })
          .eq("venue_id", restaurant.venue_id);

        if (error) throw error;
        updated++;
        logger.debug({ name: restaurant.name }, "Updated restaurant");
      } else {
        // Insert
        const { error } = await supabase.from("restaurants").insert({
          venue_id: restaurant.venue_id,
          name: restaurant.name,
          neighborhood: restaurant.neighborhood,
          cuisine: restaurant.cuisine,
          days_in_advance: restaurant.days_in_advance,
          release_time: restaurant.release_time,
          release_time_zone: "America/New_York",
          enabled: true,
        });

        if (error) throw error;
        created++;
        logger.debug({ name: restaurant.name }, "Created restaurant");
      }
    } catch (error) {
      logger.error(
        { name: restaurant.name, error: String(error) },
        "Failed to seed restaurant"
      );
    }
  }

  logger.info({ created, updated }, "Restaurant seeding complete");

  // Print summary by release time
  const { data: byReleaseTime } = await supabase
    .from("restaurants")
    .select("release_time")
    .eq("enabled", true);

  if (byReleaseTime) {
    const counts = byReleaseTime.reduce((acc, r) => {
      acc[r.release_time] = (acc[r.release_time] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    logger.info("Restaurants by release time:");
    for (const [time, count] of Object.entries(counts).sort()) {
      const label = time === "00:00" ? "12:00 AM (midnight)" : `${time} EST`;
      logger.info(`  ${label}: ${count} restaurants`);
    }
  }

  const { count } = await supabase
    .from("restaurants")
    .select("*", { count: "exact", head: true });

  logger.info(`Total restaurants in database: ${count}`);
  logger.info("\nNOTE: venue_id values are PLACEHOLDERS!");
  logger.info("You need to update them with real Resy venue IDs.");
  logger.info("Seed complete!");
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Seed failed");
  process.exit(1);
});
