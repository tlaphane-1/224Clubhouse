/**
 * seed.js
 * Seeds products and events into the 224 Clubhouse Supabase database.
 * Run: node scripts/seed.js
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually
const envPath = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const B = 'https://aogdkqczvlffgydgxsmz.supabase.co/storage/v1/object/public/brand-assets'

// ─── PRODUCTS ────────────────────────────────────────────────────────────────

const products = [
  // ── FLOWER ──
  {
    name: 'OG Kush (1g)',
    slug: 'og-kush-1g',
    description: 'OG Kush is the backbone of West Coast cannabis varieties, and has influenced countless hybrids since its arrival in the early 90s. This classic hybrid delivers a heavy, euphoric head high followed by full-body relaxation — perfect for unwinding after a long day. Terpenes of earthy pine, sour lemon, and a hint of fuel make each hit immediately recognisable. Calms stress and anxiety while keeping you mentally present. A true staple.',
    price: 12000,
    category: 'flower',
    stock_quantity: 50,
    strain_type: 'hybrid',
    thc_percentage: 22,
    weight_grams: 1,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images.jpg`],
  },
  {
    name: 'Durban Poison (1g)',
    slug: 'durban-poison-1g',
    description: 'Born on South African soil, Durban Poison is one of the world\'s most beloved pure sativa landrace strains. Its uplifting, energetic high makes it the go-to for productive days, creative sessions, and social situations. A distinctly sweet, anise-like aroma with undertones of earthy spice sets it apart. Clear-headed and stimulating without anxiety — this is daytime cannabis at its finest. Local roots, global reputation.',
    price: 10000,
    category: 'flower',
    stock_quantity: 40,
    strain_type: 'sativa',
    thc_percentage: 20,
    weight_grams: 1,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images-1.jpg`],
  },
  {
    name: 'Purple Punch (1g)',
    slug: 'purple-punch-1g',
    description: 'Purple Punch is a delicious indica that hits like dessert — sweet grape candy and blueberry muffin aromas fill the room before you even spark up. The high arrives fast with a one-two punch of euphoria straight to the head, quickly followed by a deep, sedating body melt. Best reserved for the evening, it\'s a go-to for those dealing with insomnia, pain, or just needing to fully decompress. Beautiful purple hues and frosty trichomes make it as stunning as it is potent.',
    price: 13000,
    category: 'flower',
    stock_quantity: 35,
    strain_type: 'indica',
    thc_percentage: 24,
    weight_grams: 1,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images-2.jpg`],
  },
  {
    name: 'Gorilla Glue #4 (3.5g)',
    slug: 'gorilla-glue-4-eighth',
    description: 'Named for the resin that literally glues scissors shut during trimming, Gorilla Glue #4 is one of the most decorated strains of the past decade — multiple Cannabis Cup winner, and for good reason. This potent hybrid delivers a heavy-handed cerebral euphoria that transitions into a full-body couch-lock. Earthy chocolate and diesel notes define the flavour profile. With THC levels pushing 26%, this is a serious smoke best suited to experienced consumers. Our members\' most requested re-stock.',
    price: 38000,
    category: 'flower',
    stock_quantity: 20,
    strain_type: 'hybrid',
    thc_percentage: 26,
    weight_grams: 3.5,
    is_available: true,
    is_member_only: false,
    images: [`${B}/1-1.jpg`],
  },
  {
    name: 'Blue Dream (1g)',
    slug: 'blue-dream-1g',
    description: 'Blue Dream has earned legendary status across California and beyond for good reason — it delivers a perfectly balanced high that\'s equally suited for newcomers and veterans. A sativa-dominant hybrid, it provides a swift cerebral buzz that sharpens focus and sparks motivation, while a gentle body relaxation keeps things calm. Sweet berry and vanilla notes carry through on the inhale. Ideal for social sessions, creative work, or just floating through the afternoon.',
    price: 11000,
    category: 'flower',
    stock_quantity: 45,
    strain_type: 'hybrid',
    thc_percentage: 21,
    weight_grams: 1,
    is_available: true,
    is_member_only: false,
    images: [`${B}/2.jpg`],
  },
  {
    name: 'Zkittlez (1g)',
    slug: 'zkittlez-1g',
    description: 'Zkittlez tastes exactly like the bag of sweets it\'s named after — a vivid explosion of tropical fruit, berry, and citrus that coats the palate and lingers. This award-winning indica delivers a calming, focused high that keeps you mentally alert while the body relaxes completely. Unlike most heavy indicas, Zkittlez doesn\'t sedate — it grounds. A perfect after-work strain for those who want to wind down without completely checking out. Limited availability, moves fast.',
    price: 12500,
    category: 'flower',
    stock_quantity: 25,
    strain_type: 'indica',
    thc_percentage: 23,
    weight_grams: 1,
    is_available: true,
    is_member_only: false,
    images: [`${B}/3.jpg`],
  },

  // ── EDIBLES ──
  {
    name: 'Infused Gummies (10 pack)',
    slug: 'infused-gummies-10pack',
    description: 'Ten precisely dosed fruit gummies crafted for a consistent, controllable experience every time. Each piece delivers an identical dose — no guesswork, no surprises. Available in mixed tropical flavours: mango, watermelon, and passion fruit. The onset is gradual (30–90 min), the effect long-lasting and full-bodied. Ideal for first-time edible consumers and seasoned users who value precision. Lab tested. Start with one, wait, enjoy.',
    price: 15000,
    category: 'edibles',
    stock_quantity: 30,
    is_available: true,
    is_member_only: false,
    images: [`${B}/5.jpg`],
  },
  {
    name: 'Dark Chocolate Bar (50mg)',
    slug: 'infused-dark-chocolate-bar',
    description: 'Premium 72% single-origin dark chocolate, infused with 50mg of full-spectrum cannabis extract. Scored into 10 equal pieces at 5mg each — the gold standard microdose. Rich, bitter cocoa with earthy undertones that complement the cannabis perfectly. The effect builds slowly into a warm, relaxed euphoria that pairs beautifully with music or a film. Store in a cool, dry place. Best shared — or not.',
    price: 18000,
    category: 'edibles',
    stock_quantity: 20,
    is_available: true,
    is_member_only: false,
    images: [`${B}/6.jpg`],
  },
  {
    name: 'Space Cookies (x2)',
    slug: 'space-cookies-2pack',
    description: 'Classic baked-from-scratch space cookies, made in small batches with quality cannabis-infused butter and real ingredients. Soft, chewy, and genuinely delicious — you\'d eat them without the extra. Two cookies per pack, each portioned for a moderate, body-heavy effect that builds over 60–90 minutes into a relaxed, happy calm. A 224 Clubhouse original recipe. Keep refrigerated. Not for sharing with non-members.',
    price: 12000,
    category: 'edibles',
    stock_quantity: 25,
    is_available: true,
    is_member_only: false,
    images: [`${B}/7.jpg`],
  },
  {
    name: 'Infused Honey (50ml)',
    slug: 'infused-honey-50ml',
    description: 'Raw, unfiltered South African honey infused with cannabis extract — the most versatile product in our edibles range. Stir a teaspoon into your morning rooibos, drizzle over cheese, swirl into yoghurt, or take straight off the spoon. The honey\'s natural sweetness masks the cannabis taste completely. Onset is gentle and gradual, effect is warm and mellow. 50ml glass jar with dosing guide included. Locally sourced, beautifully made.',
    price: 20000,
    category: 'edibles',
    stock_quantity: 15,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images.jpg`],
  },

  // ── ACCESSORIES ──
  {
    name: '4-Part Aluminium Grinder',
    slug: 'aluminium-grinder-4part',
    description: '63mm CNC-machined aerospace-grade aluminium grinder with a dedicated kief catcher in the bottom chamber. Diamond-cut teeth shred through even the stickiest flower with minimal effort, and the magnetic lid seals tight. Includes a scraper tool. Available in matte black and silver. Built to last years, not months — this is the last grinder you\'ll need to buy.',
    price: 25000,
    category: 'accessories',
    stock_quantity: 40,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images-1.jpg`],
  },
  {
    name: 'RAW King Size Papers (50 pack)',
    slug: 'raw-papers-king-size',
    description: 'The globally trusted standard in natural rolling papers. RAW uses an unrefined, ultra-thin hemp paper with a criss-cross watermark that prevents runs and ensures an even, slow burn. 50 king size slim papers per pack. No chalk, no chemicals, no bleach — just pure paper that lets your flower speak for itself. Vegan. The only papers worth rolling with.',
    price: 4500,
    category: 'accessories',
    stock_quantity: 100,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-square-images-2.jpg`],
  },
  {
    name: 'Glass Spoon Pipe',
    slug: 'glass-spoon-pipe',
    description: 'Hand-blown borosilicate glass pipe crafted by local artisans. Thick walls resist heat and handle daily use without chipping. Deep, wide bowl holds a generous pack, and the carb hole gives you precise airflow control. Each pipe features a unique swirl of colour — you\'ll never get the same piece twice. Easy to clean with ISO alcohol. Simple, timeless, and always reliable.',
    price: 35000,
    category: 'accessories',
    stock_quantity: 15,
    is_available: true,
    is_member_only: false,
    images: [`${B}/1-1.jpg`],
  },
  {
    name: '224 Branded Rolling Tray',
    slug: '224-rolling-tray',
    description: 'Medium-format metal rolling tray debossed with the 224 Clubhouse logo. Curved, raised edges on all sides keep your flower, papers, and filter tips exactly where you put them. Non-stick surface wipes clean in seconds. Dimensions: 27cm x 17cm — the sweet spot between portable and practical. Matte black finish. A proper workstation for a proper roll.',
    price: 28000,
    category: 'accessories',
    stock_quantity: 30,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-header-1.jpg`],
  },
  {
    name: 'Clipper Lighter',
    slug: 'clipper-lighter',
    description: 'The cult classic of lighters — fully refillable, with a replaceable flint system that gives you a lifetime of use rather than a throwaway. The removable poker doubles as a packing tool, which makes it purpose-built for cannabis use. Consistent, wind-resistant flame. Ships in a random colour — half the fun is what you get. Stock up, you\'ll lose it before it runs out.',
    price: 4000,
    category: 'accessories',
    stock_quantity: 80,
    is_available: true,
    is_member_only: false,
    images: [`${B}/2.jpg`],
  },

  // ── MERCHANDISE ──
  {
    name: '224 Clubhouse T-Shirt',
    slug: '224-tshirt',
    description: 'Heavyweight 220gsm 100% cotton tee in an oversized fit. The 224 Clubhouse wordmark is screen-printed front-centre in gold, with the Boksburg address and founding year on the back hem. Pre-washed to prevent shrinkage. Available in black and washed charcoal. Sizes S through XL. Wear it to the lounge, wear it everywhere — this is the uniform.',
    price: 39900,
    category: 'merchandise',
    stock_quantity: 50,
    is_available: true,
    is_member_only: false,
    images: [`${B}/whatsapp-image-2026-02-24-at-10.03.51-pm.jpeg`],
  },
  {
    name: '224 Clubhouse Hoodie',
    slug: '224-hoodie',
    description: '350gsm brushed fleece pullover hoodie with a ribbed kangaroo pocket, cuffs, and hem. The 224 logo is embroidered in gold thread on the left chest — subtle enough for anywhere, loud enough for those who know. Relaxed fit, drop shoulders, double-lined hood. Unisex sizing S–XL. Black. The most requested piece in our merch range, and it\'s immediately obvious why.',
    price: 69900,
    category: 'merchandise',
    stock_quantity: 30,
    is_available: true,
    is_member_only: false,
    images: [`${B}/whatsapp-image-2026-02-24-at-10.03.54-pm.jpeg`],
  },
  {
    name: '224 Dad Cap',
    slug: '224-dad-cap',
    description: 'Six-panel unstructured twill cap with a pre-curved brim. The 224 logo sits embroidered in gold on the front panel — clean, minimal, unmistakable. Brass adjustable buckle at the back for a perfect fit on any head. One size fits most. Washed black. The kind of cap you wear every day without thinking, and people always ask about.',
    price: 29900,
    category: 'merchandise',
    stock_quantity: 40,
    is_available: true,
    is_member_only: false,
    images: [`${B}/whatsapp-image-2026-02-24-at-10.03.48-pm.jpeg`],
  },
  {
    name: '224 Canvas Tote Bag',
    slug: '224-tote-bag',
    description: 'Heavy-duty 12oz natural canvas tote with the 224 Clubhouse logo screen-printed in gold on both sides. Reinforced base seams, long shoulder handles, and a spacious main compartment that fits everything from a session kit to a week\'s groceries. Unlined so it folds flat when empty. The most functional piece of merch we make.',
    price: 19900,
    category: 'merchandise',
    stock_quantity: 35,
    is_available: true,
    is_member_only: false,
    images: [`${B}/whatsapp-image-2026-02-24-at-10.03.54-pm-1.jpeg`],
  },
  {
    name: '224 Sticker Pack (5pc)',
    slug: '224-sticker-pack',
    description: 'Five premium die-cut vinyl stickers in assorted sizes and designs. Waterproof, UV-resistant, and built to last on laptops, water bottles, boards, or wherever you want to leave your mark. Includes the 224 logo mark, the full wordmark, the Boksburg address graphic, a culture slogan, and a limited-edition collab design. Every pack is slightly different. Stick responsibly.',
    price: 7900,
    category: 'merchandise',
    stock_quantity: 100,
    is_available: true,
    is_member_only: false,
    images: [`${B}/224-logo-fav-1.png`],
  },
]

// ─── EVENTS ──────────────────────────────────────────────────────────────────

const events = [
  {
    title: 'Website Launch',
    description: 'Celebrating the official online launch of 224 Clubhouse. Good vibes, good people, and the official kickoff of the digital clubhouse experience.',
    date: '2026-01-23',
    time: '18:00',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.56-pm.jpeg`,
    is_members_only: false,
    ticket_price: 0,
  },
  {
    title: 'Hike & Hale',
    description: 'A community hike through the East Rand trails followed by a relaxed session at the clubhouse. Connect with nature and the culture. All fitness levels welcome.',
    date: '2026-02-01',
    time: '07:00',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.54-pm-2.jpeg`,
    is_members_only: false,
    ticket_price: 5000,
  },
  {
    title: 'Live Comedy Session',
    description: 'An intimate live stand-up comedy night hosted at the clubhouse. Local and national comedians bringing the heat. Premium vibes, limited seats.',
    date: '2026-02-22',
    time: '19:30',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.48-pm.jpeg`,
    is_members_only: false,
    ticket_price: 15000,
  },
  {
    title: 'Hike & Hale (March)',
    description: 'Round two of the popular Hike & Hale series. Join the 224 community for a sunrise hike, fresh air, and a proper session to close it out.',
    date: '2026-03-01',
    time: '07:00',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.54-pm-1.jpeg`,
    is_members_only: false,
    ticket_price: 5000,
  },
  {
    title: 'Skyf & Braai',
    description: 'A proper South African braai with the 224 family. Fire up, smoke up, and connect. Music, food, community. The quintessential 224 experience.',
    date: '2026-03-21',
    time: '13:00',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.51-pm.jpeg`,
    is_members_only: false,
    ticket_price: 10000,
  },
  {
    title: 'The Higher Vibe',
    description: 'An elevated evening of music, art, and culture. Curated DJ sets, local vendors, and the full 224 Clubhouse experience turned up. Members get priority entry.',
    date: '2026-04-25',
    time: '20:00',
    location: '224 Rondebult Ave, Libradene, Boksburg',
    image_url: `${B}/whatsapp-image-2026-02-24-at-10.03.54-pm.jpeg`,
    is_members_only: false,
    ticket_price: 20000,
  },
]

// ─── RUN ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱  Seeding 224 Clubhouse database...\n')

  // Clear existing data first
  console.log('🗑   Clearing existing products and events...')
  await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('events').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Seed products
  console.log('\n📦  Inserting products...')
  const { data: insertedProducts, error: productError } = await supabase
    .from('products')
    .insert(products)
    .select('id, name, category, price')

  if (productError) {
    console.error('❌  Product insert error:', productError.message)
    process.exit(1)
  }

  for (const p of insertedProducts) {
    const price = `R${(p.price / 100).toFixed(2)}`
    console.log(`  ✅  [${p.category.padEnd(12)}] ${p.name.padEnd(35)} ${price}`)
  }

  // Seed events
  console.log('\n🎉  Inserting events...')
  const { data: insertedEvents, error: eventError } = await supabase
    .from('events')
    .insert(events)
    .select('id, title, date, ticket_price')

  if (eventError) {
    console.error('❌  Event insert error:', eventError.message)
    process.exit(1)
  }

  for (const e of insertedEvents) {
    const price = e.ticket_price === 0 ? 'Free' : `R${(e.ticket_price / 100).toFixed(0)}`
    console.log(`  ✅  ${e.title.padEnd(30)} ${e.date}  (${price})`)
  }

  console.log(`\n✅  Done! Seeded ${insertedProducts.length} products and ${insertedEvents.length} events.`)
}

seed().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
