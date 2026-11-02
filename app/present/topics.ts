/* Present — the weekly presentation wheel (tk, 2 Nov 2026). One wheel per person,
   28 slices: 24 topics from their life, 3 ⚡ shocks (things nobody here knows yet)
   and 1 black WILD card (the other two choose the topic). Edit freely; the server
   reads this same list, so a slice can only be drawn once per person, ever.
   Ansar's list follows the faith filter: no magic or fantasy, no "Christmas". */

export type Kind = 'topic' | 'shock' | 'wild';
export type Slice = { t: string; e: string; k: Kind };
export type Person = { id: 'taylan' | 'nihal' | 'ansar'; name: string; hue: string; slices: Slice[] };

const T = (e: string, t: string): Slice => ({ e, t, k: 'topic' });
const S = (e: string, t: string): Slice => ({ e, t, k: 'shock' });
const WILD: Slice = { e: '🃏', t: 'Wild card: the other two choose your topic', k: 'wild' };

export const PEOPLE: Person[] = [
  {
    id: 'taylan', name: 'Taylan', hue: '#1f4a45', slices: [
      WILD,
      T('🎯', "How Meta's ad auction picks a winner"),
      T('🚚', 'The last mile: how a parcel reaches a door'),
      T('🕌', 'The golden age of Islamic science'),
      T('📈', 'Compound interest and the first $10k'),
      T('🤖', 'AI agents: can a business run itself?'),
      T('🏙️', 'Istanbul: 2,700 years of one city'),
      T('🧠', 'How habits are built in the brain'),
      T('🛒', 'How Shopify ended up behind millions of stores'),
      S('⚡', 'Nuclear fusion: making a star on Earth'),
      T('🗡️', 'Salahuddin: the life of a just leader'),
      T('🤝', 'Negotiation: getting to yes'),
      T('🚢', 'How a container crosses the world'),
      T('✍️', 'Persuasion: why people actually buy'),
      T('👨‍👦', 'What great fathers do differently'),
      T('🌙', 'Fasting: what science says about Ramadan'),
      T('🏛️', 'The Ottoman Empire at its peak'),
      T('💥', 'Five famous business failures and why'),
      T('🧑‍✈️', 'Hiring and keeping great people'),
      S('⚡', 'How the pyramids were really built'),
      T('🔋', 'How an electric car works'),
      T('🌏', 'Melbourne: how our city grew'),
      T('🧾', 'Family trusts: how tax actually works'),
      T('📚', 'How the brain learns (for homeschool)'),
      T('🕰️', 'Sabr: patience in the Quran'),
      T('💤', 'Sleep: what happens at night'),
      S('⚡', 'The fungal network under every forest'),
      T('📦', 'How a product is made in China and shipped here'),
    ],
  },
  {
    id: 'nihal', name: 'Nihal', hue: '#b8612f', slices: [
      WILD,
      T('🎬', 'What makes an ad stop the scroll'),
      T('🎨', 'Colour psychology: why colours sell'),
      T('🔎', 'How to spot a winning product'),
      T('🏫', 'Homeschooling around the world'),
      T('📖', 'How children learn to read'),
      T('🧩', 'Montessori vs classical education'),
      T('🥗', 'What a growing child needs to eat'),
      T('🏛️', 'Fatima al-Fihri and the first university'),
      S('⚡', 'How rockets reach orbit'),
      T('🐪', 'Khadijah: the businesswoman'),
      T('📱', 'How the TikTok algorithm picks videos'),
      T('📷', 'Light and angles: taking a great photo'),
      T('⏰', 'Designing a day that works'),
      T('🍳', 'Turkish breakfast: history on a table'),
      T('🧭', 'The Silk Road'),
      T('🦠', 'Gut health: the second brain'),
      T('🛋️', 'Making a home feel calm'),
      T('🖋️', 'Islamic calligraphy'),
      S('⚡', 'Sharks: 400 million years of design'),
      T('🧠', 'How to remember anything'),
      T('🌱', 'Growing food at home'),
      T('😊', 'The science of happiness'),
      T('💬', 'Who buys from us, and why'),
      T('💰', 'A household budget that works'),
      T('🌸', 'Maryam: the woman chosen above all'),
      S('⚡', 'How the stock market really works'),
      T('🎞️', 'Telling a story in 60 seconds'),
    ],
  },
  {
    id: 'ansar', name: 'Ansar', hue: '#6b4a7a', slices: [
      WILD,
      T('🌋', "Volcanoes: Earth's hot heart"),
      T('🦖', 'What fossils tell us about dinosaurs'),
      T('✈️', 'How planes fly'),
      T('🪐', 'A tour of the solar system'),
      T('❤️', 'The human heart'),
      T('🌾', 'Prophet Yusuf and the seven years'),
      T('🛶', 'Prophet Nuh and the ark'),
      T('🐜', 'Ants: tiny engineers'),
      S('⚡', 'The cables that carry the internet under the sea'),
      T('⚽', 'How a pro footballer trains'),
      T('🐋', 'Whales: the biggest animals ever'),
      T('🤖', 'How robots work'),
      T('🕋', 'The Kaaba and Hajj'),
      T('🏺', 'Ancient Egypt'),
      T('🌳', 'The rainforest'),
      T('🚗', 'How a car engine works'),
      T('🦘', "Australia's amazing animals"),
      T('🌉', 'How bridges hold up'),
      S('⚡', 'Microbes: the invisible world'),
      T('⛈️', 'Where storms come from'),
      T('🦷', 'Teeth: why we brush'),
      T('🔐', 'Codes and secret messages'),
      T('🚀', 'The Moon landing'),
      T('🧭', 'Ibn Battuta: the great traveller'),
      T('🐝', 'Bees and honey (Surah An-Nahl)'),
      S('⚡', 'How glass is made from sand'),
      T('💵', 'How money works'),
    ],
  },
];

export const personById = (id: string) => PEOPLE.find(p => p.id === id);

/* The five slides every presentation follows — keeps a week of work from
   turning into a blank page. */
export const STARTER = [
  ['Hook', 'One question or picture that makes us lean in.'],
  ['The big idea', 'What is it, in one sentence a child would understand?'],
  ['Three facts', 'The three most surprising things you found.'],
  ['Why it matters to us', 'What it means for our family, our faith or our work.'],
  ['Your question', 'End with a question for the family to answer.'],
] as const;
