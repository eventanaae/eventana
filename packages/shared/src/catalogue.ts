/**
 * The Eventana catalogue, transcribed from the Eventana Canva catalogue
 * (design DAG2Pr-xAYc, "Eventana Catalog - English") and the operator
 * corrections that followed it.
 *
 * This is SEED data. Once seeded, the database is authoritative and
 * Eventana admin edits everything here from the Internal Dashboard —
 * prices, themes, delivery fees and availability must never require an
 * app release to change.
 *
 * Prices carrying `needsAdminReview` are the ones whose catalogue pages
 * had ambiguous price-to-item mapping. They are shown to staff as
 * unconfirmed rather than silently presented as final.
 */
import { aed } from './money.js';
import type {
  CelebrationType,
  DeliveryZone,
  InventoryAsset,
  PackageDefinition,
  ServiceCategory,
  ServiceDefinition,
  ThemeDefinition,
} from './types.js';

const G = (a: string, b: string) =>
  `linear-gradient(135deg,${a},${b}), repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 8px,transparent 8px 16px)`;

const ALL: CelebrationType[] = [
  'kids',
  'graduation',
  'bride',
  'baby',
  'gender',
  'adult',
  'customc',
];

/* ------------------------------------------------------------------ */
/* Delivery zones — UAE                                                */
/* ------------------------------------------------------------------ */

export const DELIVERY_ZONES: DeliveryZone[] = [
  { zoneName: 'Dubai', emirate: 'Dubai', areas: null, feeFils: aed(280), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Abu Dhabi', emirate: 'Abu Dhabi', areas: null, feeFils: aed(420), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Al Ain', emirate: 'Al Ain', areas: null, feeFils: aed(530), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Ajman', emirate: 'Ajman', areas: null, feeFils: aed(380), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Sharjah', emirate: 'Sharjah', areas: null, feeFils: aed(380), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Umm Al Quwain', emirate: 'Umm Al Quwain', areas: null, feeFils: aed(480), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Ras Al Khaimah', emirate: 'Ras Al Khaimah', areas: null, feeFils: aed(530), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  { zoneName: 'Fujairah', emirate: 'Fujairah', areas: null, feeFils: aed(660), available: true, specialConditions: null, effectiveDate: '2026-08-12' },
  {
    zoneName: 'Al Gharbia',
    emirate: 'Al Gharbia',
    areas: null,
    feeFils: null,
    available: false,
    specialConditions: 'Eventana does not currently deliver to the Al Gharbia region.',
    effectiveDate: '2026-08-12',
  },
];

/* ------------------------------------------------------------------ */
/* Physical inventory                                                  */
/* ------------------------------------------------------------------ */

export const INVENTORY_ASSETS: InventoryAsset[] = [
  { code: 'castle-lime', name: 'Bouncy Castle 4x4m', variant: 'Lime', units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'castle-cotton', name: 'Bouncy Castle 4x4m', variant: 'Cotton Candy', units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'castle-snow', name: 'Bouncy Castle 4x4m', variant: 'Snow', units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'bubble-house', name: 'Bubbles House 4x4m', variant: null, units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'ball-pool-slide', name: 'Ball Pool Slide 4x4m', variant: null, units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'amwaj-slide', name: 'Amwaj Slide 4x4m', variant: null, units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'blue-water-slide', name: 'Blue Water Slide', variant: null, units: 1, bufferBeforeMinutes: 120, bufferAfterMinutes: 180 },
  { code: 'slippery-football', name: 'Slippery Football 12x6m', variant: null, units: 1, bufferBeforeMinutes: 150, bufferAfterMinutes: 210 },
  { code: 'movie-screen', name: 'Inflatable Movie Screen 3x4m', variant: null, units: 1, bufferBeforeMinutes: 90, bufferAfterMinutes: 120 },
  { code: 'foam-machine', name: 'Foam Machine', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 120 },
  { code: 'bubbles-machine', name: 'Bubbles Machine', variant: null, units: 3, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
  { code: 'snow-machine', name: 'Snow Machine', variant: null, units: 2, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
  { code: 'popcorn-cart', name: 'Popcorn Station Cart', variant: null, units: 3, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'cotton-cart', name: 'Cotton Candy Cart', variant: null, units: 3, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'slush-cart', name: 'Slush Machine', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'corn-cart', name: 'Corn Station Cart', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'icecream-cart', name: 'Ice Cream Cart', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'hotdog-cart', name: 'Hot Dog Cart', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'pancake-cart', name: 'Pancake Station', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'nachos-cart', name: 'Nachos Station', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'burger-cart', name: 'Burger Slider Station', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'choc-fountain', name: 'Chocolate Fountain', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 120 },
  { code: 'hotchoc-urn', name: 'Hot Chocolate Station', variant: null, units: 2, bufferBeforeMinutes: 60, bufferAfterMinutes: 90 },
  { code: 'game-smash', name: 'The Smash', variant: null, units: 2, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
  { code: 'game-target', name: 'Target Master', variant: null, units: 2, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
  { code: 'game-hoop', name: 'The Hoop', variant: null, units: 2, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
  { code: 'game-roll', name: 'Roll & Rule', variant: null, units: 2, bufferBeforeMinutes: 45, bufferAfterMinutes: 60 },
];

/** Bouncy castle colours, in the order the customer app shows them. */
export const CASTLE_VARIANTS = [
  { code: 'castle-lime', name: 'Lime', swatch: '#D9F2B4' },
  { code: 'castle-cotton', name: 'Cotton Candy', swatch: '#F9C6DC' },
  { code: 'castle-snow', name: 'Snow', swatch: '#FFFFFF' },
];

/* ------------------------------------------------------------------ */
/* Service categories                                                  */
/* ------------------------------------------------------------------ */

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  { id: 'backdrop', name: 'Main Backdrop & Decoration', note: 'Your main Eventana setup — exact dimensions confirmed by Eventana', celebrationTypes: ALL, sortOrder: 1 },
  { id: 'food', name: 'Food Stations', note: 'Operated & served by the Eventana team — kids never run the machines · 4 hours · up to 40 guests', celebrationTypes: ALL, sortOrder: 2 },
  { id: 'inflatables', name: 'Inflatables', note: 'Socks required · no food or drinks inside · max 10 kids each ride', celebrationTypes: ['kids', 'customc'], sortOrder: 3 },
  { id: 'games', name: 'Games', note: '4 hours of fun & prizes', celebrationTypes: ['kids', 'graduation', 'gender', 'adult', 'customc'], sortOrder: 4 },
  { id: 'machines', name: 'Machines', note: 'Magical effects for the party', celebrationTypes: ['kids', 'gender', 'customc'], sortOrder: 5 },
  { id: 'entertainment', name: 'Entertainment', note: 'Performers kids love', celebrationTypes: ['kids', 'customc'], sortOrder: 6 },
  { id: 'activities', name: 'Activity Sessions', note: 'Price per guest · minimum 20 guests · 2 hours · we provide all supplies, equipment and two assistants · tables and chairs not included', celebrationTypes: ['kids', 'customc'], sortOrder: 7 },
  { id: 'giveaways', name: 'Giveaways', note: 'Personalized keepsakes for your guests', celebrationTypes: ALL, sortOrder: 8 },
  { id: 'extras', name: 'Extras', note: 'Finishing touches — digital invitations & extra seating', celebrationTypes: ALL, sortOrder: 9 },
];

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

type Row = Partial<ServiceDefinition> & {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  shortDescription: string;
};

const svc = (r: Row): ServiceDefinition => ({
  id: r.id,
  name: r.name,
  categoryId: r.categoryId,
  priceFils: aed(r.price),
  shortDescription: r.shortDescription,
  detail: r.detail ?? null,
  pricing: r.pricing ?? { kind: 'flat' },
  requiresAssets: r.requiresAssets ?? [],
  isInflatable: r.isInflatable ?? false,
  isFoodStation: r.isFoodStation ?? false,
  extraServingFils: r.extraServingFils ?? null,
  needsAdminReview: r.needsAdminReview ?? false,
  celebrationTypes:
    r.celebrationTypes ??
    SERVICE_CATEGORIES.find((c) => c.id === r.categoryId)?.celebrationTypes ??
    ALL,
  badge: r.badge ?? null,
  gradient: r.gradient ?? G('#F9C6DC', '#F7C948'),
});

export const SERVICES: ServiceDefinition[] = [
  // --- Main backdrop & decoration ---------------------------------
  svc({ id: 'backdropS', name: 'Small Main Backdrop', categoryId: 'backdrop', price: 1500, shortDescription: '1 panel · 1 character', detail: 'Choose any theme you like. One backdrop panel, balloons in your chosen colours, the guest of honour’s name on the backdrop, one character cutout, and one cake stand.', gradient: G('#FDE0EE', '#F9C6DC') }),
  svc({ id: 'backdropM', name: 'Medium Main Backdrop', categoryId: 'backdrop', price: 1650, shortDescription: 'Most popular · up to 2 characters', detail: 'Choose any theme you like. Two backdrop panels, balloons in your chosen colours, the guest of honour’s name on the backdrop, up to two character cutouts, and three cake stands.', badge: 'Most Popular', gradient: G('#F9C6DC', '#D9B8E8') }),
  svc({ id: 'backdropL', name: 'Giant Backdrop', categoryId: 'backdrop', price: 2200, shortDescription: '3 panels · up to 3 characters', detail: 'Choose any theme you like. Our biggest setup — about 3 m wide and 2 m tall, with three backdrop panels, balloons in your chosen colours, the guest of honour’s name on the backdrop, up to three character cutouts, and three cake stands.', gradient: G('#D9B8E8', '#7A8AC8') }),

  // --- Food stations (spec item 12: "Station", never "Kiosk") ------
  svc({ id: 'popcorn', name: 'Popcorn Station', categoryId: 'food', price: 780, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Freshly popped popcorn served throughout your event.', isFoodStation: true, extraServingFils: aed(195), requiresAssets: ['popcorn-cart'], gradient: G('#F7C948', '#FBD9C0') }),
  svc({ id: 'cotton', name: 'Cotton Candy Station', categoryId: 'food', price: 780, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Fresh, fluffy cotton candy spun to order.', isFoodStation: true, extraServingFils: aed(195), requiresAssets: ['cotton-cart'], gradient: G('#F9C6DC', '#FDE0EE') }),
  svc({ id: 'slush', name: 'Slush Station', categoryId: 'food', price: 950, shortDescription: 'Two flavours · 4 hrs · up to 40 guests · with a service attendant', detail: 'Icy fruit slush in two flavours, served in your party colours.', isFoodStation: true, extraServingFils: aed(195), requiresAssets: ['slush-cart'], gradient: G('#BDEBE4', '#7A8AC8') }),
  svc({ id: 'corn', name: 'Corn Station', categoryId: 'food', price: 900, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Hot buttered corn cups served fresh.', isFoodStation: true, extraServingFils: aed(225), requiresAssets: ['corn-cart'], gradient: G('#F7C948', '#D9F2B4') }),
  svc({ id: 'icecream', name: 'Ice Cream Station', categoryId: 'food', price: 900, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Cool, sweet scoops with toppings.', isFoodStation: true, extraServingFils: aed(225), requiresAssets: ['icecream-cart'], gradient: G('#FDE0EE', '#F7C948') }),
  svc({ id: 'hotdog', name: 'Hot Dog Station', categoryId: 'food', price: 1200, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Fresh hot dogs with all the sauces.', isFoodStation: true, extraServingFils: aed(225), requiresAssets: ['hotdog-cart'], gradient: G('#FBD9C0', '#C97B63') }),
  svc({ id: 'pancake', name: 'Pancake Station', categoryId: 'food', price: 1500, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Mini pancakes cooked to order with sweet toppings.', isFoodStation: true, extraServingFils: aed(205), requiresAssets: ['pancake-cart'], gradient: G('#F7C948', '#FBD9C0') }),
  svc({ id: 'nachos', name: 'Nachos Station', categoryId: 'food', price: 1600, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Warm nachos with cheese and dips.', isFoodStation: true, extraServingFils: aed(400), requiresAssets: ['nachos-cart'], gradient: G('#F7C948', '#E8A05B') }),
  svc({ id: 'burger', name: 'Burger Slider Station', categoryId: 'food', price: 1500, shortDescription: '4 hrs · up to 40 guests · with a service attendant', detail: 'Mini burger sliders made fresh at the station.', isFoodStation: true, extraServingFils: aed(345), requiresAssets: ['burger-cart'], gradient: G('#FBD9C0', '#C97B63') }),
  svc({ id: 'chocfountain', name: 'Chocolate Fountain', categoryId: 'food', price: 2200, shortDescription: 'With fruits & marshmallows · 4 hrs · with a service attendant', detail: 'Flowing chocolate with fruit and marshmallow dippers.', isFoodStation: true, extraServingFils: aed(550), requiresAssets: ['choc-fountain'], gradient: G('#C97B63', '#8a5a3b') }),
  svc({ id: 'hotchoc', name: 'Hot Chocolate Station', categoryId: 'food', price: 1500, shortDescription: '10L · serves 40–50 guests · with a service attendant', detail: 'Ten litres of hot chocolate with marshmallows, candy canes and sauce.', isFoodStation: true, requiresAssets: ['hotchoc-urn'], gradient: G('#C97B63', '#FBD9C0') }),

  // --- Inflatables -------------------------------------------------
  svc({ id: 'castle', name: 'Bouncy Castle 4x4m', categoryId: 'inflatables', price: 1100, shortDescription: '3 colors · max 10 kids', detail: 'A 4×4 m bouncy castle, max 10 kids per ride, available in Lime, Cotton Candy and Snow — only colours free on your date can be selected.', isInflatable: true, badge: '3 colors', requiresAssets: ['castle-lime'], gradient: G('#D9F2B4', '#BDEBE4') }),
  svc({ id: 'amwaj', name: 'Amwaj Slide 4x4m', categoryId: 'inflatables', price: 1250, shortDescription: '6 hrs · max 10 kids', detail: 'A 4×4 m inflatable slide, max 10 kids per ride. Can be run with water on request — the customer provides the water.', isInflatable: true, requiresAssets: ['amwaj-slide'], gradient: G('#AEE7DF', '#5BCFC5') }),
  svc({ id: 'bluewater', name: 'Blue Water Slide', categoryId: 'inflatables', price: 800, shortDescription: 'Splashy summer fun · max 10 kids', detail: 'An outdoor water slide, max 10 kids per ride. Needs a water source within 15 m — the customer provides the water.', isInflatable: true, requiresAssets: ['blue-water-slide'], gradient: G('#7A8AC8', '#BDEBE4') }),
  svc({ id: 'bubblehouse', name: 'Bubbles House 4x4m', categoryId: 'inflatables', price: 1500, shortDescription: '6 hrs · max 10 kids', detail: 'A 4×4 m bubbles house filled with soft bubbles for the kids to play in, max 10 kids.', isInflatable: true, requiresAssets: ['bubble-house'], gradient: G('#D9E8FB', '#BDEBE4') }),
  svc({ id: 'slippery', name: 'Slippery Football 12x6m', categoryId: 'inflatables', price: 1100, shortDescription: '6 hrs · max 10 kids · outdoor only', detail: 'A 12×6 m slippery football pitch — outdoor venues only.', isInflatable: true, requiresAssets: ['slippery-football'], gradient: G('#D9F2B4', '#5BCFC5') }),
  svc({ id: 'socks', name: 'Kids Socks (per pair)', categoryId: 'inflatables', price: 12, shortDescription: 'AED 12 per pair · required on inflatables', detail: 'Kid-safe socks — required for anyone using the inflatables. One pair per child is recommended.', pricing: { kind: 'per_piece', minQuantity: 1 }, gradient: G('#FDE0EE', '#D9E8FB') }),

  // --- Games -------------------------------------------------------
  svc({ id: 'smash', name: 'The Smash', categoryId: 'games', price: 1200, shortDescription: 'Knock down the cans!', detail: 'Knock down the cans and win a prize.', requiresAssets: ['game-smash'], gradient: G('#F06CA8', '#F7C948') }),
  svc({ id: 'target', name: 'Target Master', categoryId: 'games', price: 1200, shortDescription: 'Hit the target!', detail: 'Throw the arrows and hit the target.', requiresAssets: ['game-target'], gradient: G('#5BCFC5', '#F7C948') }),
  svc({ id: 'hoop', name: 'The Hoop', categoryId: 'games', price: 1200, shortDescription: 'Shoot & score!', detail: 'Basketball — shoot and score.', requiresAssets: ['game-hoop'], gradient: G('#F7C948', '#F06CA8') }),
  svc({ id: 'roll', name: 'Roll & Rule', categoryId: 'games', price: 1200, shortDescription: 'Fun bowling game', detail: 'Roll the ball and knock down the pins.', requiresAssets: ['game-roll'], gradient: G('#BDEBE4', '#F06CA8') }),

  // --- Machines ----------------------------------------------------
  svc({ id: 'foam', name: 'Foam Machine', categoryId: 'machines', price: 1500, shortDescription: 'Playful foam cloud', detail: 'Clouds of soft, bubbly foam the kids can dance and play in — best set up outdoors.', requiresAssets: ['foam-machine'], gradient: G('#D9E8FB', '#BDEBE4') }),
  svc({ id: 'bubbles', name: 'Bubbles Machine', categoryId: 'machines', price: 400, shortDescription: 'Shiny party bubbles', detail: 'Fills the air with bubbles for a magical party feel.', requiresAssets: ['bubbles-machine'], gradient: G('#D9E8FB', '#BDEBE4') }),
  svc({ id: 'snow', name: 'Snow Machine', categoryId: 'machines', price: 250, shortDescription: 'Magical snowfall', detail: 'Indoor and outdoor snowfall kids love.', requiresAssets: ['snow-machine'], gradient: G('#FFFFFF', '#D9E8FB') }),

  // --- Entertainment ----------------------------------------------
  svc({ id: 'clown', name: 'Acrobat Clown', categoryId: 'entertainment', price: 1500, shortDescription: '2 hrs · pro performer', detail: 'Two hours of acrobatics, wheel tricks and stilt walking for the whole party.', gradient: G('#F06CA8', '#F7C948') }),
  svc({ id: 'twisting', name: 'Balloons Twisting', categoryId: 'entertainment', price: 950, shortDescription: '4 hrs · 40 kids', detail: 'Four hours of balloon animals, flowers and hats for up to 40 kids.', gradient: G('#F9C6DC', '#5BCFC5') }),
  svc({ id: 'facepaint', name: 'Face Painting', categoryId: 'entertainment', price: 950, shortDescription: '4 hrs · 40 kids', detail: 'Four hours of face painting for up to 40 kids with kid-safe colours.', gradient: G('#C9E4C5', '#5BCFC5') }),
  svc({ id: 'mascot', name: 'Mascot Character', categoryId: 'entertainment', price: 950, shortDescription: '2 hrs · Cocomelon, Stitch, Masha or Unicorn', detail: 'A costumed character welcomes your guests and poses for photos for two hours. Choose one: Cocomelon, Stitch, Masha or Unicorn.', gradient: G('#F7C948', '#F06CA8') }),

  // --- Activity sessions (per child, min 20) -----------------------
  svc({ id: 'notebook', name: 'Notebook Decorating', categoryId: 'activities', price: 55, shortDescription: 'Decorate notebooks with stickers & craft materials', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#F7C948', '#F9C6DC') }),
  svc({ id: 'slime', name: 'Slime Making', categoryId: 'activities', price: 75, shortDescription: 'Colorful slime with safe, non-toxic ingredients', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#D9F2B4', '#5BCFC5') }),
  svc({ id: 'bracelet', name: 'Bracelet Making', categoryId: 'activities', price: 85, shortDescription: 'Design beaded bracelets with colorful materials', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#FDE0EE', '#D9B8E8') }),
  svc({ id: 'canvas', name: 'Canvas Painting', categoryId: 'activities', price: 75, shortDescription: 'Paint freely on a mini canvas', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#BDEBE4', '#F7C948') }),
  svc({ id: 'cupcake', name: 'Cupcake Decorating', categoryId: 'activities', price: 95, shortDescription: 'Frosting, chocolate & fun toppings', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#F9C6DC', '#F7C948') }),
  svc({ id: 'mirror', name: 'Mirror Decorating', categoryId: 'activities', price: 75, shortDescription: 'Add a creative touch to your own small mirror', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#D9B8E8', '#FDE0EE') }),
  svc({ id: 'pottery', name: 'Pottery Painting', categoryId: 'activities', price: 75, shortDescription: 'Paint ready-made pottery pieces with fun colors', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#FBD9C0', '#C97B63') }),
  svc({ id: 'tshirtpaint', name: 'T-shirt Painting', categoryId: 'activities', price: 75, shortDescription: 'Customize a T-shirt with fabric-safe colors', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#BDEBE4', '#F06CA8') }),
  svc({ id: 'bouquet', name: 'Flower Bouquet', categoryId: 'activities', price: 220, shortDescription: 'Arrange a beautiful bouquet with fresh flowers', pricing: { kind: 'per_child', minChildren: 20 }, needsAdminReview: true, gradient: G('#FDE0EE', '#AEE7DF') }),
  svc({ id: 'cookie', name: 'Cookie Decorating', categoryId: 'activities', price: 55, shortDescription: 'Decorate delicious cookies your way', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#FBD9C0', '#F7C948') }),
  svc({ id: 'doll', name: 'Doll Making', categoryId: 'activities', price: 160, shortDescription: 'Create & decorate a doll from fabric and foam', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#F9C6DC', '#D9B8E8') }),
  svc({ id: 'tote', name: 'Tote Bag Painting', categoryId: 'activities', price: 75, shortDescription: 'Paint a canvas tote with colorful designs', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#D9F2B4', '#F7C948') }),
  svc({ id: 'piggy', name: 'Piggy Bank Painting', categoryId: 'activities', price: 75, shortDescription: 'Personalize your own ceramic piggy bank', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#FDE0EE', '#F7C948') }),
  svc({ id: 'hatpaint', name: 'Hat Painting', categoryId: 'activities', price: 75, shortDescription: 'Paint a hat with bright, unique designs', pricing: { kind: 'per_child', minChildren: 20 }, gradient: G('#BDEBE4', '#F9C6DC') }),

  // --- Giveaways (spec item 23: no water bottles, no surprise box) --
  svc({ id: 'drawing', name: 'Digital Drawing', categoryId: 'giveaways', price: 350, shortDescription: 'Cute digital drawing · free invitation card incl.', detail: 'A digital drawing with a matching invitation card — free printing with a full package. Sent to your email within 3 days of booking — no urgent fees, order any time.', gradient: G('#D9B8E8', '#F9C6DC') }),
  svc({ id: 'hat', name: 'Customized Hat', categoryId: 'giveaways', price: 12, shortDescription: 'AED 12 each · minimum 24', detail: 'A personalized party hat printed with the guest of honour’s drawing. Minimum order 24 pieces. Made to order — ready in about 2 weeks. Attach the guest’s drawing (white background) at checkout, or we’ll create a professional digital drawing for you.', pricing: { kind: 'per_piece', minQuantity: 24 }, needsAdminReview: true, gradient: G('#F7C948', '#F9C6DC') }),
  svc({ id: 'banner', name: 'Face Banner ×10', categoryId: 'giveaways', price: 350, shortDescription: 'Custom banners with the guest of honor’s face', detail: 'Ten custom banners featuring the guest of honour’s face. Made to order — ready in about 2 weeks. Attach the guest’s drawing (white background) at checkout, or we’ll create a professional digital drawing for you.', needsAdminReview: true, gradient: G('#F9C6DC', '#7A8AC8') }),
  svc({ id: 'wrist', name: 'VIP Wristbands ×50', categoryId: 'giveaways', price: 120, shortDescription: 'VIP wristbands for all your guests', detail: 'Fifty VIP wristbands for your guests. Made to order — ready in about 2 weeks.', needsAdminReview: true, gradient: G('#BDEBE4', '#F06CA8') }),
  svc({ id: 'tshirt10', name: 'Customized T-shirts', categoryId: 'giveaways', price: 39, shortDescription: 'AED 39 each · with picture or logo · minimum 10', detail: 'Printed with the guest’s drawing or your logo. Minimum order 10 pieces. Made to order — ready in about 2 weeks. Attach the guest’s drawing (white background) at checkout, or we’ll create a professional digital drawing for you.', pricing: { kind: 'per_piece', minQuantity: 10 }, gradient: G('#FDE0EE', '#5BCFC5') }),

  // --- Extras -----------------------------------------------------
  svc({ id: 'invite-image', name: 'Digital Invitation (Image)', categoryId: 'extras', price: 150, shortDescription: 'Themed image invitation to share', detail: 'A digital invitation card designed in your party theme, delivered as an image ready to share. Sent to your email within 3 days of booking — no urgent fees, order any time.', gradient: G('#FDE0EE', '#D9B8E8') }),
  svc({ id: 'invite-video', name: 'Digital Invitation (Video)', categoryId: 'extras', price: 250, shortDescription: 'Animated themed video invitation', detail: 'An animated video invitation designed in your party theme, ready to share with your guests. Sent to your email within 3 days of booking — no urgent fees, order any time.', gradient: G('#D9B8E8', '#7A8AC8') }),
  svc({ id: 'tables-chairs', name: 'Extra Tables & Chairs (10 guests)', categoryId: 'extras', price: 550, shortDescription: 'Fully styled seating for 10 more guests', detail: 'Themed tables and chairs seating for 10 extra guests, fully styled. Each seat includes a customized placemat with the name and party theme, a card holder, a water bottle with a custom label, plates, a wooden spoon & fork, and a balloon centerpiece. Add one set for every extra 10 guests.', pricing: { kind: 'per_piece', minQuantity: 1 }, gradient: G('#FBD9C0', '#F9C6DC') }),
];

export const SERVICE_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/* Fixed packages                                                      */
/* ------------------------------------------------------------------ */

const item = (name: string, detail: string, assets: string[] = []) => ({ name, detail, assets });

export const PACKAGES: PackageDefinition[] = [
  {
    id: 'golden',
    name: 'Golden Birthday',
    priceFils: aed(5999),
    capacity: 'Up to 40 kids',
    durationHours: 4,
    tag: 'MOST POPULAR',
    gradient: G('#F9C6DC', '#F7C948'),
    hasCastleChoice: true,
    items: [
      item('3 Entertainers', 'Three entertainers running dance, games and activities all party long.'),
      item('Bouncy Castle 4x4m', 'A 4×4 m bouncy castle, max 10 kids per ride, in your chosen colour.', ['castle-lime']),
      item('Bubbles House 4x4m', 'Eventana’s single Bubbles House, max 10 kids per ride.', ['bubble-house']),
      item('Face Painting (40 kids)', 'Kid-safe face painting for up to 40 children.'),
      item('Cotton Candy (40 kids)', 'Fresh, fluffy cotton candy for up to 40 kids.', ['cotton-cart']),
      item('Popcorn (40 kids)', 'Freshly popped popcorn for up to 40 kids.', ['popcorn-cart']),
      item('Welcoming Stand', 'A themed welcome sign at your party entrance.'),
      item('3 Backdrops', 'Three balloon backdrops in your theme colours.'),
      item('Tables & Chairs Theme Setup', 'Each seat includes a customized placemat with your child’s name and party theme, card holder, water bottle with customized label, plates, wooden spoon & fork, and a balloon centerpiece.'),
      item('10 Giveaways', 'A drawing tablet for every guest — handed out during the party games, a keepsake to take home.'),
      item('Music Speaker', 'A party speaker for your playlist.'),
      item('3 Cake Stands', 'Three themed cake display stands.'),
    ],
  },
  {
    id: 'silver',
    name: 'Silver Birthday',
    priceFils: aed(4799),
    capacity: 'Up to 40 kids',
    durationHours: 4,
    tag: "LET'S PARTY",
    gradient: G('#BDEBE4', '#F9C6DC'),
    hasCastleChoice: false,
    items: [
      item('Ball Pool Slide 4x4m', 'A 4×4 m ball pool slide, max 10 kids per ride.', ['ball-pool-slide']),
      item('2 Entertainers', 'Two entertainers running dance, games and activities all party long.'),
      item('Face Painting (40 kids)', 'Kid-safe face painting for up to 40 children.'),
      item('Cotton Candy (40 kids)', 'Fresh, fluffy cotton candy for up to 40 kids.', ['cotton-cart']),
      item('Popcorn (40 kids)', 'Freshly popped popcorn for up to 40 kids.', ['popcorn-cart']),
      item('Welcoming Stand', 'A themed welcome sign at your party entrance.'),
      item('2 Backdrops', 'Two balloon backdrops in your theme colours.'),
      item('2 Cake Stands', 'Two themed cake display stands.'),
      item('10 Game Prizes', 'Ten prizes for the party games.'),
      item('Music Speaker', 'A party speaker for your playlist.'),
      item('Tables & Chairs Theme Setup', 'Each seat includes a customized placemat with your child’s name and party theme, card holder, water bottle with customized label, plates, wooden spoon & fork, and a balloon centerpiece.'),
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze Birthday',
    priceFils: aed(3599),
    capacity: 'Up to 40 kids',
    durationHours: 4,
    tag: 'GREAT PRICE',
    gradient: G('#FBD9C0', '#F0A8B8'),
    hasCastleChoice: false,
    items: [
      item('Instant Photography (10 prints)', 'Ten instant prints of candid party moments, handed over on the spot.'),
      item('2 Entertainers', 'Two entertainers running dance, games and activities all party long.'),
      item('Cotton Candy (40 kids)', 'Fresh, fluffy cotton candy for up to 40 kids.', ['cotton-cart']),
      item('Popcorn (40 kids)', 'Freshly popped popcorn for up to 40 kids.', ['popcorn-cart']),
      item('Welcoming Stand', 'A themed welcome sign at your party entrance.'),
      item('2 Backdrops', 'Two balloon backdrops in your theme colours.'),
      item('2 Cake Stands', 'Two themed cake display stands.'),
      item('10 Giveaways', 'A drawing tablet for every guest — handed out during the party games, a keepsake to take home.'),
      item('Music Speaker', 'A party speaker for your playlist.'),
      item('Tables & Chairs Theme Setup', 'Each seat includes a customized placemat with your child’s name and party theme, card holder, water bottle with customized label, plates, wooden spoon & fork, and a balloon centerpiece.'),
    ],
  },
  {
    id: 'spa',
    name: 'Spa Party',
    priceFils: aed(5999),
    capacity: 'Up to 20 kids',
    durationHours: 4,
    tag: 'FOR GIRLS',
    gradient: G('#FDE0EE', '#D9B8E8'),
    hasCastleChoice: false,
    items: [
      item('15 Pink Robes with Stand', 'Fifteen pink spa robes displayed on a stand.'),
      item('Kids Manicure', 'Gentle, kid-safe polish throughout the party.'),
      item('Kids Pedicure', 'Gentle, kid-safe polish throughout the party.'),
      item('Braid Corner', 'A braiding station with hair ties and mirrors.'),
      item('Spa Tables & Essentials', 'Napkins, plates, mask bowls, cucumber slices, face masks, hair ties and mirrors.'),
      item('Tables & Chairs (10 kids)', 'Themed tables and chairs seating for up to 10 kids.'),
      item('Cotton Candy (20 kids)', 'Fresh, fluffy cotton candy for up to 20 kids.', ['cotton-cart']),
      item('Popcorn (20 kids)', 'Freshly popped popcorn for up to 20 kids.', ['popcorn-cart']),
      item('Welcoming Stand', 'A themed welcome sign at your party entrance.'),
      item('2 Backdrops', 'Two balloon backdrops in your theme colours.'),
      item('1 Cake Stand', 'A themed cake display stand.'),
    ],
  },
  {
    id: 'summer',
    name: 'Summer Party',
    priceFils: aed(4999),
    capacity: 'Up to 40 kids',
    durationHours: 4,
    tag: 'OUTDOOR FUN',
    gradient: G('#AEE7DF', '#F7C948'),
    hasCastleChoice: false,
    items: [
      item('Ball Pool Slide 4x4m', 'A 4×4 m ball pool slide, max 10 kids per ride.', ['ball-pool-slide']),
      item('Foam Machine', 'Clouds of soft, bubbly foam the kids can dance and play in.', ['foam-machine']),
      item('Ice Cream (40 kids)', 'Cool, sweet scoops for up to 40 kids.', ['icecream-cart']),
      item('Cotton Candy (40 kids)', 'Fresh, fluffy cotton candy for up to 40 kids.', ['cotton-cart']),
      item('3 Entertainers', 'Three entertainers running dance, games and activities all party long.'),
      item('2 Backdrops', 'Two balloon backdrops in your theme colours.'),
      item('1 Cake Stand', 'A themed cake display stand.'),
      item('10 Game Prizes', 'Ten prizes for the party games.'),
      item('Music Speaker', 'A party speaker for your playlist.'),
      item('Welcoming Stand', 'A themed welcome sign at your party entrance.'),
      item('Tables & Chairs Theme Setup', 'Each seat includes a customized placemat with your child’s name and party theme, card holder, water bottle with customized label, plates, wooden spoon & fork, and a balloon centerpiece.'),
    ],
  },
  {
    id: 'movie',
    name: 'Movie Night',
    priceFils: aed(2199),
    capacity: 'Up to 40 kids',
    durationHours: 4,
    tag: 'COZY NIGHT',
    gradient: G('#B8C4E8', '#3B3641'),
    hasCastleChoice: false,
    items: [
      item('Inflatable Movie Screen 3x4m', 'A 3×4 m inflatable screen for outdoor or large indoor venues.', ['movie-screen']),
      item('Projector + Speaker', 'HD projector and speaker, set up by the Eventana team.'),
      item('Hot Chocolate (40 kids)', 'Ten litres of hot chocolate with marshmallows, candy canes and sauce.', ['hotchoc-urn']),
      item('Popcorn (40 kids)', 'Freshly popped popcorn for up to 40 kids.', ['popcorn-cart']),
      item('10 Bean Bags + Tables + Lights', 'Ten black bean bags with tables and lights for a cosy cinema corner.'),
    ],
  },
];

export const PACKAGE_BY_ID = new Map(PACKAGES.map((p) => [p.id, p]));

/** Package items whose food station can take extra servings after booking. */
export const PACKAGE_ITEM_TO_SERVICE: Array<[string, string]> = [
  ['Cotton Candy', 'cotton'],
  ['Popcorn', 'popcorn'],
  ['Ice Cream', 'icecream'],
  ['Hot Chocolate', 'hotchoc'],
];

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

const PALETTES: Array<[string, string, string]> = [
  ['#F9C6DC', '#D9B8E8', '#F7C948'],
  ['#BDEBE4', '#7A8AC8', '#ffffff'],
  ['#F7C948', '#F0A8B8', '#ffffff'],
  ['#AEE7DF', '#5a9e6e', '#F7C948'],
  ['#FDE0EE', '#F0A8B8', '#D9B8E8'],
  ['#B8C4E8', '#3B3641', '#F7C948'],
  ['#D9F2B4', '#5BCFC5', '#F9C6DC'],
  ['#FBD9C0', '#C97B63', '#F7C948'],
  ['#F0A8B8', '#c2453a', '#ffffff'],
  ['#BDEBE4', '#5BCFC5', '#FDE0EE'],
];

/**
 * The 41 standard Eventana kids themes. "Barbie" appeared twice in the
 * source list and is stored once, per the operator's instruction.
 * Selecting any of these carries NO custom theme fee.
 */
const KIDS_THEME_ROWS: Array<[string, string, number]> = [
  ['K-Pop Demon', 'Characters|Girls', 5],
  ['Snow White', 'Princess|Girls', 8],
  ['Barbie', 'Characters|Girls', 4],
  ['Polo', 'Sports|Neutral', 6],
  ['Al Wasl Club', 'Sports|Boys', 2],
  ['Halloween', 'Fantasy|Neutral', 5],
  ['Nissan Patrol / Fatek Car', 'Cars|Boys', 5],
  ['Jungle', 'Animals|Adventure', 3],
  ['Mickey Safari', 'Characters|Adventure', 3],
  ['Super Mario', 'Characters|Boys', 8],
  ['Disney Princess', 'Princess|Girls', 0],
  ['Cocomelon', 'Characters|Cute', 9],
  ['Frozen', 'Princess|Girls', 1],
  ['Space', 'Adventure|Neutral', 5],
  ['Mermaid', 'Fantasy|Girls', 9],
  ['Butterfly', 'Cute|Girls', 4],
  ['Spider-Man', 'Characters|Boys', 8],
  ['Cinnamon', 'Cute|Neutral', 7],
  ['Lilo', 'Characters|Cute', 9],
  ['Fairy', 'Fantasy|Girls', 0],
  ['Luffy', 'Characters|Boys', 8],
  ['Hello Kitty', 'Characters|Cute|Girls', 4],
  ['Captain America', 'Characters|Boys', 5],
  ['Iron Man', 'Characters|Boys', 8],
  ['Cinnamoroll', 'Characters|Cute', 1],
  ['Bow', 'Cute|Girls', 4],
  ['Horses', 'Animals|Neutral', 7],
  ['Dinosaur', 'Animals|Adventure|Boys', 3],
  ['Candy', 'Cute|Neutral', 0],
  ['Cars', 'Cars|Boys', 8],
  ['Football', 'Sports|Boys', 6],
  ["Old MacDonald's", 'Animals|Cute', 7],
  ['Unicorn', 'Fantasy|Cute|Girls', 0],
  ['Carnival', 'Adventure|Neutral', 2],
  ['Teddy Bear', 'Cute|Neutral', 7],
  ['Princess Peach', 'Princess|Characters|Girls', 4],
  ['Angel & Stitch', 'Characters|Cute', 9],
  ['Toy Story', 'Characters|Neutral', 2],
  ['Masha & The Bear', 'Characters|Cute', 7],
  ['Strawberry', 'Cute|Girls', 8],
  ['Paw Patrol', 'Characters|Animals', 2],
];

const POPULAR_THEMES = ['Unicorn', 'Frozen', 'Paw Patrol'];

/** Discovery + AI-recommendation tags. Editable by Eventana. */
export const THEME_TAGS = [
  'Princess',
  'Characters',
  'Sports',
  'Cars',
  'Animals',
  'Fantasy',
  'Cute',
  'Adventure',
  'Girls',
  'Boys',
  'Neutral',
];

export const THEMES: ThemeDefinition[] = [
  ...KIDS_THEME_ROWS.map((r, i) => ({
    id: `t${i}`,
    name: r[0],
    tags: r[1].split('|'),
    colors: PALETTES[r[2]],
    gradient: G(PALETTES[r[2]][0], PALETTES[r[2]][1]),
    popular: POPULAR_THEMES.includes(r[0]),
    featured: POPULAR_THEMES.includes(r[0]),
    active: true,
    celebrationType: 'kids' as CelebrationType,
    sortOrder: i,
  })),
  // Non-kids celebrations ship with NO ready-made themes — those customers get a
  // free custom-theme brief instead (owner decision). Removing these libraries
  // also clears them from the home "Trending Themes" carousel.
];

/* ------------------------------------------------------------------ */
/* Celebration types                                                   */
/* ------------------------------------------------------------------ */

export const CELEBRATION_TYPES = [
  { id: 'kids' as const, label: 'Kids Birthday', sub: 'Packages, themes & entertainment', gradient: G('#F9C6DC', '#F7C948'), route: 'explore' as const },
  { id: 'graduation' as const, label: 'Graduation Party', sub: 'School, uni & adult grads', gradient: G('#B8C4E8', '#F7C948'), route: 'build' as const },
  { id: 'bride' as const, label: 'Bride to Be', sub: 'Bridal showers & setups', gradient: G('#FDE0EE', '#D9B8E8'), route: 'build' as const },
  { id: 'baby' as const, label: 'Baby Shower', sub: 'Sweet celebration setups', gradient: G('#BDEBE4', '#FDE0EE'), route: 'build' as const },
  { id: 'gender' as const, label: 'Gender Reveal', sub: 'The big pink-or-blue moment', gradient: G('#F9C6DC', '#BDEBE4'), route: 'build' as const },
  { id: 'adult' as const, label: 'Adult Birthday', sub: 'Elegant grown-up parties', gradient: G('#D9B8E8', '#B8C4E8'), route: 'build' as const },
  { id: 'customc' as const, label: 'Custom Celebration', sub: 'Anything you can imagine', gradient: G('#F7C948', '#F9C6DC'), route: 'build' as const },
];

/**
 * Service groups Eventana has not priced yet for the non-kids
 * celebrations. Shown as an explicit "needs Eventana input" card rather
 * than filled with invented services.
 */
export const MISSING_SERVICE_NOTES: Partial<Record<CelebrationType, string>> = {
  graduation: 'Entrance Stand, Graduation Decoration & Tables',
  bride: 'Elegant Decoration, Flower Arrangements, Tables & Chairs',
  baby: 'Baby Shower Decoration, Welcome Stand & Guest Activities',
  gender: 'Voting Stand, Reveal Experience & Boy/Girl Characters',
  adult: 'Elegant Decoration & F&B Stations',
};

export const BRAND = {
  instagram: '@eventana.uae',
  phone: '+971 56 450 0777',
  colors: {
    ink: '#3B3641',
    pink: '#F06CA8',
    pinkDeep: '#E94F9C',
    pinkSoft: '#FDEFF6',
    mint: '#5BCFC5',
    mintSoft: '#E9F8F5',
    yellow: '#F7C948',
    yellowSoft: '#FFF3D6',
    cream: '#FFFDFA',
    muted: '#b3a8a0',
    green: '#2e9e7e',
    greenSoft: '#E3F6EF',
    red: '#c2453a',
    redSoft: '#FCE9E5',
  },
} as const;
