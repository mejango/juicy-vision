import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useThemeStore, useSettingsStore, LANGUAGES } from '../../stores'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
}

// Identity traits for filtering - empathetic, human-centered
type TraitId = 'maker' | 'artist' | 'community' | 'supporter' | 'visionary' | 'coder' | 'changemaker' | 'entrepreneur' | 'gamer' | 'researcher' | 'local' | 'curious' | 'dreamer' | 'rebel' | 'degen' | 'introvert' | 'chaotic' | 'normie' | 'rich' | 'giving' | 'lazy' | 'famous' | 'anon' | 'touched-grass' | 'climate' | 'health' | 'creative' | 'food' | 'science' | 'ai' | 'web3'

interface Trait {
  id: TraitId
  label: string
  keywords: string[] // suggestions containing these words match this trait
  expanded?: boolean // only show when expanded
}

const traits: Trait[] = [
  // Core identities
  {
    id: 'maker',
    label: 'making things',
    keywords: ['build', 'create', 'launch', 'start', 'bootstrap', 'make', 'develop', 'design', 'infrastructure', 'platform', 'app', 'startup', 'business', 'saas', 'product'],
  },
  {
    id: 'artist',
    label: 'expressing myself',
    keywords: ['film', 'music', 'album', 'art', 'comic', 'animation', 'game', 'podcast', 'book', 'newsletter', 'magazine', 'photography', 'documentary', 'creative', 'zine', 'theater', 'gallery', 'weird'],
  },
  {
    id: 'community',
    label: 'bringing people together',
    keywords: ['community', 'collective', 'club', 'local', 'neighborhood', 'mutual', 'garden', 'space', 'workshop', 'membership', 'charity', 'fundraiser', 'campaign', 'drive', 'relief'],
  },
  {
    id: 'supporter',
    label: 'looking to support',
    keywords: ['find', 'discover', 'support', 'back', 'pay into', 'show me', 'what projects'],
  },
  {
    id: 'visionary',
    label: 'thinking big',
    keywords: ['billion', 'unicorn', 'empire', 'domination', 'legacy', 'movement', 'change', 'disrupt', 'future', 'outlive', 'generational', 'inspire', 'dream', 'possible', 'bigger'],
  },
  {
    id: 'coder',
    label: 'writing code',
    keywords: ['open source', 'github', 'npm', 'cli', 'api', 'library', 'framework', 'compiler', 'language', 'protocol', 'infrastructure', 'database', 'extension', 'dev', 'code', 'revnet', 'token', 'dao', 'governance', 'bonding', 'quadratic'],
  },
  {
    id: 'changemaker',
    label: 'fixing what\'s broken',
    keywords: ['public good', 'climate', 'education', 'research', 'journalism', 'investigative', 'political', 'protest', 'mutual aid', 'relief', 'decentralization', 'broken system', 'replace'],
  },
  {
    id: 'entrepreneur',
    label: 'starting a business',
    keywords: ['startup', 'business', 'bootstrap', 'saas', 'marketplace', 'franchise', 'agency', 'consulting', 'revenue', 'profit', 'company', 'enterprise', 'venture', 'commercial'],
  },
  {
    id: 'gamer',
    label: 'playing games',
    keywords: ['game', 'esports', 'tournament', 'prediction', 'bracket', 'fantasy', 'betting', 'arcade', 'speedrun'],
  },
  {
    id: 'researcher',
    label: 'learning & teaching',
    keywords: ['research', 'education', 'course', 'tutorial', 'bootcamp', 'thesis', 'lab', 'scholarship', 'mentor', 'teaching', 'learning', 'training', 'workshop', 'school', 'academy', 'tutoring', 'lesson'],
  },
  {
    id: 'local',
    label: 'helping my neighborhood',
    keywords: ['local', 'neighborhood', 'city', 'community garden', 'food truck', 'cafe', 'coworking', 'park', 'cleanup'],
  },
  {
    id: 'curious',
    label: 'just exploring',
    keywords: ['what is', 'how do', 'show me', 'walk me', 'explain', 'discover', 'trending', 'successful', 'inspiring'],
  },
  // Fun & ambitious
  {
    id: 'dreamer',
    label: 'dreaming impossible things',
    keywords: ['billion', 'unicorn', 'empire', 'legacy', 'movement', 'future', 'outlive', 'generational', 'dream', 'possible', 'bigger', 'domination'],
  },
  {
    id: 'rebel',
    label: 'fighting the system',
    keywords: ['replace', 'broken', 'disrupt', 'decentralization', 'protest', 'political', 'investigative', 'journalism', 'public good'],
  },
  {
    id: 'degen',
    label: 'being a degen',
    keywords: ['token', 'revnet', 'bonding', 'meme', 'prediction', 'betting', 'fantasy', 'game', 'arcade'],
  },
  {
    id: 'introvert',
    label: 'avoiding people',
    keywords: ['automated', 'autonomous', 'trustless', 'self-sustaining', 'perpetual', 'sleep', 'api', 'cli', 'code'],
  },
  {
    id: 'chaotic',
    label: 'causing chaos',
    keywords: ['weird', 'pirate', 'haunted', 'mystery', 'escape', 'immersive', 'puppet', 'experimental', 'meme', 'domination'],
  },
  {
    id: 'normie',
    label: 'being normal',
    keywords: ['small business', 'consulting', 'agency', 'service', 'cafe', 'food truck', 'tattoo', 'vintage', 'climbing', 'skate'],
  },
  {
    id: 'rich',
    label: 'getting rich',
    keywords: ['billion', 'unicorn', 'ipo', 'revenue', 'profit', 'wealth', 'empire', 'domination', 'bootstrap', 'startup'],
  },
  {
    id: 'giving',
    label: 'giving back',
    keywords: ['public good', 'open source', 'mutual aid', 'free', 'community', 'scholarship', 'relief', 'charity', 'nonprofit', 'impact'],
  },
  {
    id: 'lazy',
    label: 'doing less work',
    keywords: ['automated', 'autonomous', 'perpetual', 'self-sustaining', 'sleep', 'trustless', 'programmable'],
  },
  {
    id: 'famous',
    label: 'getting famous',
    keywords: ['podcast', 'newsletter', 'film', 'documentary', 'music', 'album', 'streaming', 'media', 'journalism'],
  },
  {
    id: 'anon',
    label: 'staying anonymous',
    keywords: ['trustless', 'autonomous', 'decentralization', 'on-chain', 'protocol', 'api'],
  },
  {
    id: 'touched-grass',
    label: 'touching grass',
    keywords: ['local', 'neighborhood', 'garden', 'park', 'cleanup', 'cafe', 'coworking', 'climbing', 'skate', 'food truck'],
  },
  // More useful identities
  {
    id: 'climate',
    label: 'saving the planet',
    keywords: ['climate', 'solar', 'renewable', 'carbon', 'reforestation', 'sustainable', 'green', 'clean tech', 'ocean', 'biodiversity', 'regenerative'],
  },
  {
    id: 'health',
    label: 'improving health',
    keywords: ['health', 'mental health', 'wellness', 'fitness', 'medical', 'biotech', 'longevity', 'therapy', 'patient', 'clinical'],
  },
  {
    id: 'creative',
    label: 'creating things',
    keywords: ['art', 'music', 'film', 'game', 'animation', 'design', 'photography', 'podcast', 'streaming', 'content', 'creator', 'studio'],
  },
  {
    id: 'food',
    label: 'making food',
    keywords: ['restaurant', 'food', 'coffee', 'brewery', 'bakery', 'kitchen', 'farm', 'meal', 'beverage', 'cafe'],
  },
  {
    id: 'science',
    label: 'doing science',
    keywords: ['research', 'scientific', 'lab', 'thesis', 'physics', 'chemistry', 'biology', 'space', 'astronomy', 'clinical', 'experiment'],
  },
  {
    id: 'ai',
    label: 'building AI',
    keywords: ['AI', 'machine learning', 'ML', 'model', 'neural', 'autonomous', 'robotics', 'computer vision', 'NLP', 'generative'],
  },
  {
    id: 'web3',
    label: 'going onchain',
    keywords: ['token', 'DAO', 'protocol', 'L2', 'rollup', 'bridge', 'DEX', 'wallet', 'NFT', 'staking', 'oracle', 'decentralized', 'on-chain', 'blockchain'],
  },
]

// Check if a suggestion matches a trait
function suggestionMatchesTrait(suggestion: string, trait: Trait): boolean {
  const lower = suggestion.toLowerCase()
  return trait.keywords.some(keyword => lower.includes(keyword.toLowerCase()))
}

const allSuggestions = [
  // === GETTING STARTED ===
  'What is Juicy?',
  'How do I start a fundraiser?',
  'How can I start a business?',
  'Help me plan my fundraise',
  'Is it free to create a project?',
  'What can I build with Juicy?',
  'Show me how it works',
  'Walk me through the basics',
  'What makes Juicy different?',
  'How does the money flow?',

  // === DISCOVERY ===
  'Show me successful projects',
  'Show me trending projects',
  'Show me biggest projects right now',
  'Show me creative projects',
  'What are people building?',
  'Show me weird projects',
  'Find something inspiring',
  'Show me projects like mine',
  'What launched this week?',
  'Show me underfunded gems',

  // === FINDING & SUPPORTING ===
  'Find a project to support',
  'What projects need funding?',
  'Show me projects I can pay into',
  'Support an open source project',
  'Back an indie developer',
  'Find projects by category',
  'Discover new projects',
  'Support a creator I follow',
  'Find Ethereum projects',
  'Show me Base projects',
  'Projects on Optimism',
  'Projects on Arbitrum',
  'Find projects in my city',
  'Show me climate projects',
  'Find education projects',

  // === OPEN SOURCE & DEVELOPERS ===
  'Fund my open source library',
  'Sustain my GitHub project',
  'Get paid for my npm package',
  'Fund my dev tools',
  'Support protocol development',
  'Fund infrastructure I maintain',
  'Get sponsors for my framework',
  'Fund my VS Code extension',
  'Monetize my API',
  'Fund my CLI tool',
  'Fund my database project',
  'Support my security research',
  'Fund my compiler',
  'Maintain critical infrastructure',
  'Fund my programming language',

  // === AMBITIOUS / BOLD ===
  'Start my billion dollar business',
  'Build the next unicorn',
  'Launch my empire',
  'Fund world domination',
  'Create generational wealth',
  'Build something that outlives me',
  'Start a movement',
  'Change an industry',
  'Disrupt everything',
  'Go from zero to IPO',
  'Build my legacy',
  'Replace a broken system',
  'Fund the future I want to see',
  'Build critical infrastructure',
  'Create a new category',

  // === BUSINESS & STARTUPS ===
  'Bootstrap my startup',
  'Launch my small business',
  'Fund my side project',
  'Start a worker-owned co-op',
  'Fund my hardware startup',
  'Launch a collective business',
  'Start my consulting firm',
  'Fund my SaaS product',
  'Launch my marketplace',
  'Fund my physical product',
  'Start my agency',
  'Fund my franchise',
  'Launch my service business',
  'Fund my subscription business',

  // === INVESTMENT & OWNERSHIP ===
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'How do I share revenue with backers?',
  'Create investor agreements',
  'Set up revenue sharing',
  'Configure profit distribution',
  'Manage cap table on-chain',
  'Create vesting schedules',
  'Set up milestone payments',

  // === FUNDRAISING CAMPAIGNS ===
  'Run a community fundraiser',
  'Organize a charity drive',
  'Make an auditable political campaign',
  'Fund a local initiative',
  'Fund disaster relief',
  'Run a matching campaign',
  'Launch a crowdfund with deadline',
  'Set up recurring donations',
  'Create a giving circle',
  'Fund mutual aid',
  'Start mutual fund',

  // === CREATIVE - MUSIC & AUDIO ===
  'Fund my album',
  'Launch my music project',
  'Fund my podcast',
  'Start my record label',
  'Fund my audio drama',
  'Launch my radio show',
  'Fund my sound design studio',
  'Support my music venue',

  // === CREATIVE - VISUAL ===
  'Fund my indie game',
  'Crowdfund my film',
  'Fund my art collective',
  'Support my webcomic',
  'Launch my animation project',
  'Fund my documentary',
  'Launch my photography project',
  'Fund my VR experience',
  'Support my NFT collection',
  'Fund my gallery',

  // === CREATIVE - WRITTEN ===
  'Fund my newsletter',
  'Support my journalism',
  'Fund my book',
  'Launch my magazine',
  'Fund investigative reporting',
  'Support my blog',
  'Fund my zine',
  'Launch my publishing house',
  'Fund my translation project',
  'Support independent media',

  // === CREATIVE - WEIRD & WONDERFUL ===
  'Fund my weird art project',
  'Start a meme coin with utility',
  'Fund my experimental theater',
  'Launch my puppet show',
  'Fund my street performance',
  'Fund my escape room',
  'Launch my pirate ship bar',
  'Fund my immersive experience',
  'Start my mystery dinner theater',
  'Fund my haunted house',
  'Launch my themed restaurant',
  'Fund my artistic protest',

  // === EDUCATION & RESEARCH ===
  'Fund my research',
  'Support my course',
  'Fund my tutorial series',
  'Launch my bootcamp',
  'Fund my educational content',
  'Support my mentorship program',
  'Fund my thesis',
  'Launch my learning platform',
  'Fund my scholarship program',
  'Support my lab',
  'Fund my field research',
  'Launch my workshop series',

  // === COMMUNITY + EDUCATION + BUSINESS ===
  'Start a community bootcamp business',
  'Launch a cohort-based course with membership',
  'Build a paid learning community',
  'Start a tutoring collective',
  'Launch a coding bootcamp for my community',
  'Build a community education startup',
  'Start a membership-based workshop business',
  'Fund my community teaching studio',
  'Launch a local skills training business',
  'Build an education co-op',
  'Start a neighborhood tutoring business',
  'Launch a community apprenticeship program',
  'Build a peer learning membership',
  'Start a community mentorship business',
  'Fund my teaching collective',

  // === GAMING & ENTERTAINMENT ===
  'Fund my esports team',
  'Launch my gaming community',
  'Fund my speedrun project',
  'Support my mod development',
  'Fund my game server',
  'Launch my tournament series',
  'Fund my game studio',
  'Support my streaming setup',
  'Fund my board game',
  'Launch my arcade',

  // === COMMUNITY & SOCIAL ===
  'Can I run a membership program?',
  'Start a fan club',
  'Build a paid community',
  'Can I fundraise for a collective?',
  'Run a discord with benefits',
  'Fund my community garden',
  'Start a buying club',
  'Launch a tool library',
  'Fund my coworking space',
  'Start my hackerspace',
  'Fund my community kitchen',
  'Launch my social club',

  // === LOCAL & IRL ===
  'Fund my community center',
  'Start a neighborhood project',
  'Fund my local park cleanup',
  'Launch a community fridge',
  'Fund my bike repair collective',
  'Start a free store',
  'Fund my community workshop',
  'Crowdfund my tattoo shop',
  'Fund my urban garden',
  'Start my vintage arcade',
  'Launch my food truck',
  'Fund my cat cafe',
  'Start my maker space',
  'Fund my community radio',
  'Launch my skate park',
  'Fund my climbing gym',

  // === OPERATIONS & HOW-TO ===
  'How do supporters get rewarded?',
  'How can I reward supporters?',
  'How do I withdraw funds?',
  'How transparent is the funding?',
  'Can supporters cash out?',
  'How do refunds work?',
  'Can I set funding goals?',
  'How do I add team members?',
  'How do I update my project?',

  // === PLATFORM & INFRASTRUCTURE ===
  'Create a fundraising platform',
  'Build my own crowdfunding site',
  'Embed fundraising in my app',
  'White-label fund management',
  'Create a grants program',
  'Build a giving platform',
  'Run fundraisers for my community',
  'Host multiple projects on my site',
  'Build a philanthropy dashboard',
  'Create an impact marketplace',

  // === ADVANCED / PRO ===
  'How do I whitelabel Juicy?',
  'Custom branding for my platform',
  'Run a retroactive funding round',
  'Create a quadratic funding pool',
  'Launch a network state project',
  'Set up cross-chain fundraising',
  'Create programmable payouts',
  'Build custom approval flows',
  'Configure complex splits',
  'Set up staged releases',

  // === CRYPTO NATIVE ===
  'Launch a token for my project',
  'Fund public goods',
  'Fund protocol development',
  'Create a treasury for my group',
  'Set up on-chain governance',
  'Launch a revnet',
  'Fund Ethereum infrastructure',
  'Support blockchain research',
  'Fund decentralization',
  'Build web3 public goods',

  // === AUTONOMOUS & AUTOMATED ===
  'Build an automated revenue machine',
  'Create a self-sustaining treasury',
  'Launch a perpetual funding engine',
  'Money that works while I sleep',
  'Build an autonomous treasury',
  'Create a self-growing fund',
  'Set up automated distributions',
  'Create trustless payouts',

  // === JB AS APPLICATION PLATFORM ===
  // Games & prediction markets (like Defifa)
  'Build a prediction game on Juicebox',
  'Create a sports bracket with real stakes',
  'Launch a fantasy league with payouts',
  'Build a World Cup game like Defifa',
  'Create a tournament with prize pools',
  'Make a prediction market game',
  'Build a betting pool for my friends',
  'Create a poker league treasury',
  // Coordination games
  'Build a coordination game',
  'Create a collective action mechanism',
  'Launch a staking game',
  'Build a commitment device',
  'Create a savings game',
  'Launch a group challenge with stakes',
  // Economic games
  'Build a bonding curve game',
  'Create a token launch game',
  'Design an economic experiment',
  'Build a market simulation',
  'Create an auction game',
  'Launch a Dutch auction',
  // Social applications
  'Build a social token platform',
  'Create a reputation system',
  'Launch a governance game',
  'Build a voting mechanism',
  'Create a delegation market',
  // JB as infrastructure
  'Use JB as my app\'s payment layer',
  'Build my app on Juicebox rails',
  'JB as backend for my dapp',
  'Embed JB mechanics in my game',
  'Use JB for in-game economies',
  'Build on JB primitives',

  // === DEMOS & INTERACTIVE ===
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Walk me through a payment',
  'Show me cash out in action',
  'Demo the token mechanics',
  'Try a test transaction',

  // === INSPIRATIONAL ===
  'Tell me a success story',
  'What could go right?',
  'Inspire me',
  'What makes a project take off?',
  'Dream big with me',
  'What if money wasn\'t the problem?',
  'Help me think bigger',
  'What would you fund?',
  'Show me what\'s possible',
  'Who\'s doing it right?',

  // === LAZY / AUTOMATED (for "doing less work" & "avoiding people") ===
  'Make money while I sleep',
  'Set it and forget it treasury',
  'Passive income on autopilot',
  'Zero maintenance fundraising',
  'Let the code do the work',
  'Automated revenue streams',
  'Trustless income machine',
  'Self-running project',
  'Hands-off treasury management',
  'Perpetual motion money',
  'Fire and forget funding',
  'Run a project from my couch',
  'Minimal effort maximum returns',
  'Automate my side hustle',
  'Build once collect forever',
  'No meetings required',
  'Async-first treasury',
  'Let smart contracts handle it',
  'Programmable passive income',
  'Self-sustaining without me',

  // === DEGEN (for "being a degen") ===
  'Ape into something new',
  'Launch a meme treasury',
  'Degen funding pool',
  'High risk high reward project',
  'Ponzinomics but ethical',
  'Token go up treasury',
  'Betting pool for degens',
  'Prediction market mayhem',
  'Fantasy sports with real stakes',
  'Arcade token economy',
  'Bonding curve experiments',
  'Revnet for the culture',
  'Gamified treasury',
  'Speculation station',
  'Diamond hands treasury',
  'WAGMI fund',
  'To the moon project',
  'Degen collective treasury',
  'Floor price treasury',
  'Mint and pray',

  // === CHAOTIC (for "causing chaos") ===
  'Fund beautiful chaos',
  'Weird experiment treasury',
  'Chaotic good funding',
  'Disrupt for fun',
  'Meme lord treasury',
  'Absurdist art fund',
  'Chaos magic project',
  'Random acts of funding',
  'Experimental mayhem',
  'Pirate radio treasury',
  'Underground weird stuff',
  'Subversive art collective',
  'Anarchy but organized',
  'Controlled demolition fund',
  'Creative destruction treasury',
  'Break things beautifully',
  'Fund the inexplicable',
  'Mystery box treasury',
  'Haunted house collective',
  'Immersive chaos experience',

  // === RICH (for "getting rich") ===
  'Path to my first million',
  'Wealth building machine',
  'Empire starts here',
  'From broke to rich',
  'Revenue maximization',
  'Profit-first treasury',
  'Unicorn trajectory',
  'IPO preparation fund',
  'Wealth accumulation engine',
  'Money printing operation',
  'Bootstrap to billions',
  'Startup to acquisition',
  'Revenue rocket ship',
  'Profit margins on steroids',
  'Wealth generation protocol',
  'Get rich systematically',
  'Million dollar project',
  'Exit strategy treasury',
  'Compound wealth fund',
  'Financial freedom machine',

  // === POOR / PUBLIC GOOD (for "staying broke") ===
  'Fund public goods forever',
  'Open source sustainability',
  'Free stuff for everyone',
  'Community first always',
  'Give it all away',
  'Mutual aid network',
  'Scholarship for strangers',
  'Relief fund for anyone',
  'Charity without overhead',
  'Free education treasury',
  'Commons funding pool',
  'Nonprofit but onchain',
  'Altruism as a service',
  'Help without expectation',
  'Pure public benefit',
  'Community wealth fund',
  'Share the wealth treasury',
  'Collective benefit pool',
  'Free forever project',
  'Gift economy treasury',

  // === ANON (for "staying anonymous") ===
  'Anonymous treasury',
  'Pseudonymous project',
  'No KYC required',
  'Privacy-first funding',
  'Trustless and faceless',
  'Anonymous collective',
  'Decentralized identity fund',
  'On-chain only presence',
  'Protocol-native project',
  'API-driven treasury',
  'No doxxing allowed',
  'Anonymous art fund',
  'Pseudonymous media outlet',
  'Privacy-preserving treasury',
  'Autonomous collective',
  'Anon dev fund',
  'Pseudonymous publishing',
  'Anonymous research fund',
  'No-name collective',
  'Shadow treasury',

  // === FAMOUS (for "getting famous") ===
  'Launch my media empire',
  'Viral content treasury',
  'Influencer launch fund',
  'Famous overnight project',
  'Content creator treasury',
  'Streaming career fund',
  'Podcast to millions',
  'Newsletter empire',
  'Film festival fund',
  'Documentary series treasury',
  'Music industry disruption',
  'Album launch treasury',
  'Media mogul starter',
  'Journalism that matters',
  'Breaking news fund',
  'Viral moment treasury',
  'Fame machine project',
  'Audience building fund',
  'Clout treasury',
  'Main character energy fund',

  // === NORMIE (for "being normal") ===
  'Just a regular business',
  'Normal small business fund',
  'Simple service business',
  'Consulting practice treasury',
  'Agency starter fund',
  'Coffee shop crowdfund',
  'Food truck launch',
  'Tattoo parlor fund',
  'Vintage shop treasury',
  'Climbing gym fund',
  'Skate shop starter',
  'Regular retail business',
  'Basic service company',
  'Traditional business model',
  'Simple honest work fund',
  'Main street business',
  'Neighborhood shop fund',
  'Local service treasury',
  'Family business fund',
  'Classic entrepreneurship',

  // === TOUCHED GRASS (for "touching grass") ===
  'Touch grass treasury',
  'Outdoor project fund',
  'Nature connection fund',
  'Local park improvement',
  'Community garden expansion',
  'Neighborhood beautification',
  'Urban farming collective',
  'Outdoor adventure fund',
  'Trail maintenance treasury',
  'Beach cleanup fund',
  'River restoration project',
  'Green space treasury',
  'Fresh air collective',
  'Farmers market fund',
  'Outdoor fitness treasury',
  'Bike path project',
  'Hiking club treasury',
  'Nature education fund',
  'Wildlife preservation',
  'Outdoor community space',

  // === NEW - CREATOR ECONOMY ===
  'Fund my YouTube channel',
  'Launch my Twitch career',
  'Monetize my TikTok content',
  'Fund my creator studio',
  'Build my personal brand',
  'Launch my merch line',
  'Fund my content creation',
  'Start my Patreon alternative',
  'Build a creator collective',
  'Fund my video production',
  'Launch my livestream setup',
  'Fund my content house',
  'Start my media company',
  'Build my audience first',
  'Monetize my expertise',
  'Fund my online course',
  'Launch my coaching business',
  'Build my speaking career',
  'Fund my brand deals',
  'Create my creator fund',

  // === NEW - WEB3 & CRYPTO ===
  'Launch my token',
  'Build a DAO from scratch',
  'Create on-chain governance',
  'Fund my protocol',
  'Build decentralized infrastructure',
  'Launch my L2',
  'Fund my rollup',
  'Build a bridge',
  'Create a DEX',
  'Fund my wallet app',
  'Build an NFT marketplace',
  'Launch my staking protocol',
  'Create a lending platform',
  'Fund my oracle network',
  'Build a privacy protocol',
  'Launch my identity solution',
  'Create a social graph',
  'Fund my data availability layer',
  'Build cross-chain tooling',
  'Launch my MEV solution',

  // === NEW - AI & TECH ===
  'Fund my AI startup',
  'Build an AI agent',
  'Train my own model',
  'Fund my ML research',
  'Create an AI assistant',
  'Build AI infrastructure',
  'Fund my data company',
  'Launch my AI API',
  'Build AI-powered tools',
  'Fund my robotics project',
  'Create autonomous systems',
  'Build my AI lab',
  'Fund my computer vision project',
  'Launch my NLP startup',
  'Build generative AI tools',
  'Fund my AI hardware',
  'Create AI for good',
  'Build ethical AI',
  'Fund my AI safety research',
  'Launch my AI studio',

  // === NEW - SUSTAINABILITY ===
  'Fund my solar project',
  'Build renewable energy',
  'Launch my carbon removal',
  'Fund my reforestation',
  'Create circular economy',
  'Build sustainable fashion',
  'Fund my zero-waste business',
  'Launch my recycling startup',
  'Create sustainable packaging',
  'Fund my clean tech',
  'Build green infrastructure',
  'Launch my climate tech',
  'Fund my ocean cleanup',
  'Create sustainable agriculture',
  'Build vertical farming',
  'Fund my food tech',
  'Launch my plant-based startup',
  'Create lab-grown products',
  'Fund my biodiversity project',
  'Build regenerative systems',

  // === NEW - HEALTH & WELLNESS ===
  'Fund my health tech',
  'Build mental health app',
  'Launch my wellness platform',
  'Fund my fitness startup',
  'Create telehealth solution',
  'Build medical devices',
  'Fund my biotech research',
  'Launch my longevity project',
  'Create personalized medicine',
  'Fund my diagnostics startup',
  'Build health data platform',
  'Launch my therapy app',
  'Fund my meditation startup',
  'Create sleep technology',
  'Build nutrition platform',
  'Fund my wearables company',
  'Launch my health community',
  'Create patient support',
  'Fund my clinical trials',
  'Build healthcare access',

  // === NEW - FINANCE & FINTECH ===
  'Fund my neobank',
  'Build payment infrastructure',
  'Launch my investing app',
  'Create savings platform',
  'Fund my insurance startup',
  'Build credit solutions',
  'Launch my remittance service',
  'Create financial education',
  'Fund my trading platform',
  'Build wealth management',
  'Launch my robo-advisor',
  'Create expense tracking',
  'Fund my accounting software',
  'Build invoicing tools',
  'Launch my payroll startup',
  'Create tax solutions',
  'Fund my lending startup',
  'Build credit scoring',
  'Launch my financial API',
  'Create embedded finance',

  // === NEW - SOCIAL IMPACT ===
  'Fund my nonprofit',
  'Build impact measurement',
  'Launch my social enterprise',
  'Create employment programs',
  'Fund my housing project',
  'Build affordable housing',
  'Launch my homeless solution',
  'Create food security',
  'Fund my education nonprofit',
  'Build literacy programs',
  'Launch my youth program',
  'Create elder care',
  'Fund my disability services',
  'Build accessibility tools',
  'Launch my refugee support',
  'Create immigrant services',
  'Fund my justice reform',
  'Build rehabilitation programs',
  'Launch my reentry services',
  'Create community healing',

  // === NEW - INFRASTRUCTURE ===
  'Fund my cloud startup',
  'Build developer tools',
  'Launch my DevOps platform',
  'Create monitoring solutions',
  'Fund my security startup',
  'Build authentication',
  'Launch my identity platform',
  'Create access management',
  'Fund my networking startup',
  'Build edge computing',
  'Launch my CDN',
  'Create serverless platform',
  'Fund my container platform',
  'Build orchestration tools',
  'Launch my observability',
  'Create logging platform',
  'Fund my database startup',
  'Build data pipelines',
  'Launch my analytics platform',
  'Create BI tools',

  // === NEW - MARKETPLACES ===
  'Fund my two-sided marketplace',
  'Build a services marketplace',
  'Launch my talent platform',
  'Create a freelancer marketplace',
  'Fund my rental marketplace',
  'Build peer-to-peer platform',
  'Launch my resale marketplace',
  'Create a B2B marketplace',
  'Fund my vertical marketplace',
  'Build a niche marketplace',
  'Launch my local marketplace',
  'Create a global marketplace',
  'Fund my commodity marketplace',
  'Build a digital goods marketplace',
  'Launch my subscription marketplace',
  'Create a managed marketplace',
  'Fund my reverse marketplace',
  'Build an auction marketplace',
  'Launch my wholesale marketplace',
  'Create a curated marketplace',

  // === NEW - CONSUMER APPS ===
  'Fund my social app',
  'Build a dating app',
  'Launch my messaging app',
  'Create a photo app',
  'Fund my video app',
  'Build a music app',
  'Launch my productivity app',
  'Create a notes app',
  'Fund my calendar app',
  'Build a task manager',
  'Launch my habit tracker',
  'Create a journal app',
  'Fund my language app',
  'Build a learning app',
  'Launch my kids app',
  'Create a family app',
  'Fund my travel app',
  'Build a maps alternative',
  'Launch my food app',
  'Create a recipe app',

  // === NEW - ENTERPRISE ===
  'Fund my enterprise SaaS',
  'Build sales tools',
  'Launch my CRM alternative',
  'Create marketing automation',
  'Fund my HR platform',
  'Build recruiting tools',
  'Launch my onboarding platform',
  'Create employee engagement',
  'Fund my collaboration tools',
  'Build project management',
  'Launch my knowledge base',
  'Create documentation tools',
  'Fund my workflow automation',
  'Build no-code platform',
  'Launch my integration platform',
  'Create API management',
  'Fund my compliance tools',
  'Build risk management',
  'Launch my procurement platform',
  'Create vendor management',

  // === NEW - MEDIA & ENTERTAINMENT ===
  'Fund my streaming service',
  'Build a music platform',
  'Launch my podcast network',
  'Create a video platform',
  'Fund my live events',
  'Build virtual concerts',
  'Launch my sports platform',
  'Create a betting platform',
  'Fund my news platform',
  'Build a journalism startup',
  'Launch my content network',
  'Create a studio',
  'Fund my production company',
  'Build a talent agency',
  'Launch my rights management',
  'Create royalty distribution',
  'Fund my licensing platform',
  'Build syndication network',
  'Launch my advertising platform',
  'Create brand partnerships',

  // === NEW - REAL WORLD ASSETS ===
  'Fund my real estate project',
  'Build property technology',
  'Launch my tokenized assets',
  'Create fractional ownership',
  'Fund my art investment',
  'Build collectibles platform',
  'Launch my wine fund',
  'Create luxury goods market',
  'Fund my car investment',
  'Build equipment leasing',
  'Launch my infrastructure fund',
  'Create renewable energy tokens',
  'Fund my commodity trading',
  'Build precious metals platform',
  'Launch my carbon credits',
  'Create ESG investing',
  'Fund my farmland project',
  'Build agriculture investment',
  'Launch my timber fund',
  'Create natural resources fund',

  // === NEW - COMMUNITY BUILDING ===
  'Fund my online community',
  'Build a membership platform',
  'Launch my private network',
  'Create an alumni network',
  'Fund my professional community',
  'Build an interest-based community',
  'Launch my fan community',
  'Create a creator community',
  'Fund my location-based community',
  'Build a neighborhood app',
  'Launch my hobby community',
  'Create a support group',
  'Fund my accountability community',
  'Build a mastermind group',
  'Launch my peer group',
  'Create a cohort community',
  'Fund my network state',
  'Build a digital nation',
  'Launch my virtual city',
  'Create a coordinated community',

  // === NEW - SCIENCE & RESEARCH ===
  'Fund my scientific research',
  'Build research infrastructure',
  'Launch my citizen science',
  'Create open research',
  'Fund my academic project',
  'Build research collaboration',
  'Launch my lab equipment',
  'Create research datasets',
  'Fund my clinical research',
  'Build biomedical research',
  'Launch my physics project',
  'Create chemistry research',
  'Fund my space research',
  'Build astronomy project',
  'Launch my oceanography',
  'Create geology research',
  'Fund my archaeology',
  'Build paleontology project',
  'Launch my anthropology',
  'Create linguistics research',

  // === NEW - ARTS & CULTURE ===
  'Fund my museum',
  'Build a cultural center',
  'Launch my arts festival',
  'Create a residency program',
  'Fund my public art',
  'Build a sculpture garden',
  'Launch my performance venue',
  'Create a dance company',
  'Fund my orchestra',
  'Build a choir program',
  'Launch my opera company',
  'Create a theater company',
  'Fund my comedy venue',
  'Build an improv theater',
  'Launch my circus',
  'Create a magic show',
  'Fund my cultural preservation',
  'Build heritage sites',
  'Launch my historical society',
  'Create archival project',

  // === NEW - SPORTS & FITNESS ===
  'Fund my sports team',
  'Build a sports league',
  'Launch my fitness brand',
  'Create a gym chain',
  'Fund my athletic training',
  'Build sports technology',
  'Launch my fantasy sports',
  'Create sports analytics',
  'Fund my sports media',
  'Build a sports network',
  'Launch my athlete fund',
  'Create sports scholarships',
  'Fund my sports facility',
  'Build sports infrastructure',
  'Launch my adventure sports',
  'Create outdoor recreation',
  'Fund my extreme sports',
  'Build action sports media',
  'Launch my fitness app',
  'Create workout content',

  // === NEW - FOOD & BEVERAGE ===
  'Fund my restaurant',
  'Build a restaurant chain',
  'Launch my ghost kitchen',
  'Create a meal delivery',
  'Fund my food brand',
  'Build a CPG company',
  'Launch my beverage brand',
  'Create a brewery',
  'Fund my distillery',
  'Build a winery',
  'Launch my coffee roaster',
  'Create a tea company',
  'Fund my bakery',
  'Build a chocolate company',
  'Launch my ice cream brand',
  'Create a snack company',
  'Fund my sauce company',
  'Build a condiment brand',
  'Launch my specialty food',
  'Create a farmers market',

  // === NEW - FASHION & BEAUTY ===
  'Fund my fashion brand',
  'Build a clothing line',
  'Launch my streetwear',
  'Create a luxury brand',
  'Fund my sustainable fashion',
  'Build an accessories brand',
  'Launch my jewelry line',
  'Create a watch brand',
  'Fund my beauty brand',
  'Build a skincare line',
  'Launch my makeup brand',
  'Create a haircare line',
  'Fund my fragrance brand',
  'Build a wellness brand',
  'Launch my athleisure',
  'Create a footwear brand',
  'Fund my eyewear brand',
  'Build a bag brand',
  'Launch my fashion tech',
  'Create a virtual fashion',

  // === NEW - HARDWARE & IOT ===
  'Fund my hardware startup',
  'Build consumer electronics',
  'Launch my smart home',
  'Create IoT devices',
  'Fund my wearable tech',
  'Build medical devices',
  'Launch my robotics company',
  'Create automation tools',
  'Fund my drone company',
  'Build autonomous vehicles',
  'Launch my mobility startup',
  'Create e-bikes',
  'Fund my scooter company',
  'Build electric vehicles',
  'Launch my charging network',
  'Create battery technology',
  'Fund my solar company',
  'Build energy storage',
  'Launch my semiconductor',
  'Create chip design',
]

// POPULAR (cyan) - Entry points, universal appeal, high-value starting questions
const popularSuggestions = new Set([
  // Core questions everyone asks
  'What is Juicy?',
  'How do I start a fundraiser?',
  'How can I start a business?',
  'Show me how it works',
  'What can I build with Juicy?',
  'Help me plan my fundraise',
  'Is it free to create a project?',
  // Common use cases
  'Fund my open source library',
  'Run a community fundraiser',
  'Bootstrap my startup',
  'Fund my indie game',
  'Fund my podcast',
  'Fund my album',
  'Fund my newsletter',
  'Fund my documentary',
  'Fund my research',
  'Support my course',
  'Fund my small business',
  'Launch my side project',
  // Discovery
  'Show me successful projects',
  'Discover new projects',
  'What are people building?',
  'Find a project to support',
  'Find something inspiring',
  // Key mechanics
  'How do supporters get rewarded?',
  'Can supporters cash out?',
  'Fund public goods',
  'How can I reward supporters?',
  // Games & applications
  'Create a tournament with prize pools',
  'Build a betting pool for my friends',
  // Creator economy
  'Fund my YouTube channel',
  'Monetize my expertise',
  'Fund my online course',
  'Build my personal brand',
  'Fund my Twitch career',
  'Fund my content creation',
  'Launch my merch line',
  // AI & Tech
  'Fund my AI startup',
  'Build AI-powered tools',
  'Build an AI agent',
  // Sustainability
  'Fund my climate tech',
  'Create sustainable packaging',
  'Fund my solar project',
  // Health
  'Fund my health tech',
  'Build mental health app',
  'Launch my wellness platform',
  // Consumer
  'Fund my social app',
  'Launch my productivity app',
  // Community
  'Fund my online community',
  'Build a membership platform',
  'Start a fan club',
  'Build a paid community',
  // Food & Beverage
  'Fund my restaurant',
  'Launch my coffee roaster',
  'Launch my food truck',
  'Fund my brewery',
  // Fashion
  'Fund my fashion brand',
  'Launch my streetwear',
  // Local & IRL
  'Fund my community center',
  'Fund my coworking space',
  'Fund my maker space',
  'Start my hackerspace',
  // Sports
  'Fund my esports team',
  'Fund my sports team',
  // Arts
  'Fund my film',
  'Fund my art collective',
  'Support my webcomic',
  'Launch my animation project',
])

// PRO (orange) - Advanced, institutional, complex configurations
const proSuggestions = new Set([
  // Platform building
  'How do I whitelabel Juicy?',
  'White-label fund management',
  'Create a grants program',
  'Embed fundraising in my app',
  'Custom branding for my platform',
  'Build a philanthropy dashboard',
  // Complex treasury
  'Run a retroactive funding round',
  'Create a quadratic funding pool',
  'Configure complex splits',
  'Set up staged releases',
  'Build custom approval flows',
  'Create programmable payouts',
  // Investment mechanics
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'How do I share revenue with backers?',
  'Manage cap table on-chain',
  'Create vesting schedules',
  // Institutional
  'Make an auditable political campaign',
  'Launch a network state project',
  'Set up cross-chain fundraising',
  // Expertise needed
  'Get sponsors for my framework',
  'Maintain critical infrastructure',
  'Launch a revnet',
  // JB as platform infrastructure
  'Use JB as my app\'s payment layer',
  'Build my app on Juicebox rails',
  'JB as backend for my dapp',
  'Embed JB mechanics in my game',
  'Use JB for in-game economies',
  'Build on JB primitives',
  'Build a bonding curve game',
  'Design an economic experiment',
  // Automated/technical
  'Set it and forget it treasury',
  'Self-running project',
  'Hands-off treasury management',
  'Async-first treasury',
  'Let smart contracts handle it',
  'Self-sustaining without me',
  // Anonymous/privacy
  'Anonymous treasury',
  'Pseudonymous project',
  'No KYC required',
  'Privacy-first funding',
  'Trustless and faceless',
  'Anonymous collective',
  'Decentralized identity fund',
  'On-chain only presence',
  'Protocol-native project',
  'API-driven treasury',
  'No doxxing allowed',
  'Privacy-preserving treasury',
  'Autonomous collective',
  'Anon dev fund',
  'Pseudonymous publishing',
  'Anonymous research fund',
  'Shadow treasury',
  // NEW - Web3 & Crypto
  'Launch my token',
  'Build a DAO from scratch',
  'Create on-chain governance',
  'Fund my protocol',
  'Build decentralized infrastructure',
  'Launch my L2',
  'Fund my rollup',
  'Build a bridge',
  'Create a DEX',
  'Fund my oracle network',
  'Build a privacy protocol',
  'Launch my identity solution',
  'Create a social graph',
  'Fund my data availability layer',
  'Build cross-chain tooling',
  'Launch my MEV solution',
  // NEW - AI Infrastructure
  'Train my own model',
  'Build AI infrastructure',
  'Fund my ML research',
  'Build my AI lab',
  'Fund my AI safety research',
  // NEW - Infrastructure
  'Fund my cloud startup',
  'Build developer tools',
  'Launch my DevOps platform',
  'Create monitoring solutions',
  'Fund my security startup',
  'Build authentication',
  'Launch my identity platform',
  'Fund my networking startup',
  'Build edge computing',
  'Launch my CDN',
  'Create serverless platform',
  'Fund my container platform',
  'Build data pipelines',
  'Launch my analytics platform',
  // NEW - Enterprise
  'Fund my enterprise SaaS',
  'Build workflow automation',
  'Build no-code platform',
  'Launch my integration platform',
  'Create API management',
  'Fund my compliance tools',
  // NEW - Finance
  'Build payment infrastructure',
  'Create embedded finance',
  'Launch my financial API',
  // NEW - Real World Assets
  'Launch my tokenized assets',
  'Create fractional ownership',
  'Launch my carbon credits',
  'Create ESG investing',
])

// DEMO (pink) - Interactive, hands-on, "show me"
const demoSuggestions = new Set([
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Walk me through a payment',
  'Show me cash out in action',
  'Demo the token mechanics',
  'Try a test transaction',
  'Show me how it works',
  'Walk me through the basics',
  // NEW - Discovery demos
  'Show me trending projects',
  'Show me biggest projects right now',
  'Show me creative projects',
  'Show me weird projects',
  'Show me projects like mine',
  'What launched this week?',
  'Show me underfunded gems',
  'Show me Base projects',
  // NEW - Mechanics demos
  'How does the money flow?',
  'How do refunds work?',
  'How do I withdraw funds?',
  'How transparent is the funding?',
])

// FUN (green) - Creative, playful, weird, joyful, degen, chaotic
const funSuggestions = new Set([
  // Weird & wonderful projects
  'Fund my weird art project',
  'Launch my pirate ship bar',
  'Fund my cat cafe',
  'Fund my escape room',
  'Start my mystery dinner theater',
  'Fund my haunted house',
  'Launch my themed restaurant',
  'Fund my immersive experience',
  'Launch my puppet show',
  // Discovery with personality
  'Show me weird projects',
  'Find something inspiring',
  'Show me underfunded gems',
  // Inspirational
  'Tell me a success story',
  'What could go right?',
  'Inspire me',
  'Dream big with me',
  'What if money wasn\'t the problem?',
  'Help me think bigger',
  'What would you fund?',
  'Show me what\'s possible',
  'Who\'s doing it right?',
  // Creative expression
  'Fund my artistic protest',
  'Fund my experimental theater',
  'Fund my street performance',
  // Games & playful applications
  'Build a prediction game on Juicebox',
  'Create a sports bracket with real stakes',
  'Launch a fantasy league with payouts',
  'Build a World Cup game like Defifa',
  'Create a tournament with prize pools',
  'Make a prediction market game',
  'Build a betting pool for my friends',
  'Create a poker league treasury',
  'Create a savings game',
  'Launch a group challenge with stakes',
  'Create an auction game',
  'Launch a Dutch auction',
  // Lazy vibes
  'Passive income on autopilot',
  'Perpetual motion money',
  'Fire and forget funding',
  'Run a project from my couch',
  'Minimal effort maximum returns',
  // Degen culture
  'Ape into something new',
  'Launch a meme treasury',
  'Degen funding pool',
  'Ponzinomics but ethical',
  'Token go up treasury',
  'Betting pool for degens',
  'Prediction market mayhem',
  'Fantasy sports with real stakes',
  'Arcade token economy',
  'Gamified treasury',
  'Speculation station',
  'Diamond hands treasury',
  'WAGMI fund',
  'To the moon project',
  'Degen collective treasury',
  'Mint and pray',
  // Chaotic energy
  'Fund beautiful chaos',
  'Weird experiment treasury',
  'Chaotic good funding',
  'Disrupt for fun',
  'Meme lord treasury',
  'Absurdist art fund',
  'Chaos magic project',
  'Random acts of funding',
  'Experimental mayhem',
  'Pirate radio treasury',
  'Underground weird stuff',
  'Subversive art collective',
  'Anarchy but organized',
  'Creative destruction treasury',
  'Break things beautifully',
  'Fund the inexplicable',
  'Mystery box treasury',
  'Haunted house collective',
  'Immersive chaos experience',
  // Touch grass fun
  'Touch grass treasury',
  'Fresh air collective',
  // NEW - Creator Economy fun
  'Fund my content house',
  'Launch my livestream setup',
  'Fund my merch line',
  // NEW - Entertainment
  'Fund my streaming service',
  'Build virtual concerts',
  'Launch my sports platform',
  'Create a betting platform',
  'Fund my comedy venue',
  'Build an improv theater',
  'Launch my circus',
  'Create a magic show',
  // NEW - Food & Beverage fun
  'Launch my ghost kitchen',
  'Fund my brewery',
  'Fund my distillery',
  'Launch my ice cream brand',
  'Create a snack company',
  // NEW - Fashion fun
  'Launch my streetwear',
  'Create a virtual fashion',
  // NEW - Hardware fun
  'Fund my drone company',
  'Create e-bikes',
  'Fund my scooter company',
  // NEW - Sports fun
  'Launch my fantasy sports',
  'Fund my adventure sports',
  'Create outdoor recreation',
  'Fund my extreme sports',
  // NEW - Community fun
  'Fund my fan community',
  'Launch my hobby community',
  'Create a support group',
  // NEW - Arts fun
  'Fund my circus',
  'Launch my arts festival',
  'Create a dance company',
])

// BOLD (purple) - Ambitious, visionary, empire-building, getting rich
const boldSuggestions = new Set([
  'Start my billion dollar business',
  'Build the next unicorn',
  'Launch my empire',
  'Fund world domination',
  'Create generational wealth',
  'Build something that outlives me',
  'Start a movement',
  'Change an industry',
  'Disrupt everything',
  'Go from zero to IPO',
  'Build my legacy',
  'Replace a broken system',
  'Fund the future I want to see',
  'Build critical infrastructure',
  'Create a new category',
  // Big vision tech
  'Fund my programming language',
  'Fund my compiler',
  // Autonomous systems
  'Build an automated revenue machine',
  'Create a self-sustaining treasury',
  'Launch a perpetual funding engine',
  'Money that works while I sleep',
  'Build an autonomous treasury',
  // Coordination & governance systems
  'Build a coordination game',
  'Create a collective action mechanism',
  'Build a commitment device',
  'Build a social token platform',
  'Create a reputation system',
  'Launch a governance game',
  'Build a voting mechanism',
  'Create a delegation market',
  'Build a market simulation',
  // Automated wealth
  'Make money while I sleep',
  'Automated revenue streams',
  'Trustless income machine',
  'Programmable passive income',
  // Getting rich
  'Path to my first million',
  'Wealth building machine',
  'Empire starts here',
  'From broke to rich',
  'Revenue maximization',
  'Profit-first treasury',
  'Unicorn trajectory',
  'IPO preparation fund',
  'Wealth accumulation engine',
  'Money printing operation',
  'Bootstrap to billions',
  'Startup to acquisition',
  'Revenue rocket ship',
  'Profit margins on steroids',
  'Wealth generation protocol',
  'Get rich systematically',
  'Million dollar project',
  'Exit strategy treasury',
  'Compound wealth fund',
  'Financial freedom machine',
  // NEW - Web3 Bold
  'Launch my L2',
  'Fund my rollup',
  'Build decentralized infrastructure',
  'Fund my protocol',
  'Create a social graph',
  // NEW - AI Bold
  'Fund my AI startup',
  'Train my own model',
  'Build my AI lab',
  'Create autonomous systems',
  'Fund my robotics project',
  // NEW - Climate Bold
  'Launch my carbon removal',
  'Build renewable energy',
  'Fund my clean tech',
  'Create circular economy',
  // NEW - Health Bold
  'Fund my biotech research',
  'Launch my longevity project',
  'Create personalized medicine',
  // NEW - Finance Bold
  'Fund my neobank',
  'Build payment infrastructure',
  'Create embedded finance',
  // NEW - Enterprise Bold
  'Fund my enterprise SaaS',
  'Build no-code platform',
  'Launch my integration platform',
  // NEW - Marketplace Bold
  'Fund my two-sided marketplace',
  'Build a global marketplace',
  'Create a managed marketplace',
  // NEW - Community Bold
  'Fund my network state',
  'Build a digital nation',
  'Launch my virtual city',
  'Create a coordinated community',
  // NEW - Science Bold
  'Fund my scientific research',
  'Build research infrastructure',
  'Fund my space research',
  // NEW - Hardware Bold
  'Build autonomous vehicles',
  'Launch my semiconductor',
  'Create chip design',
  'Fund my battery technology',
  // NEW - Real Assets Bold
  'Launch my tokenized assets',
  'Create fractional ownership',
  'Fund my infrastructure fund',
])

// Layout constants
const CHIP_HEIGHT = 40
const ROW_COUNT = 80
const CHIPS_PER_ROW = 40

interface RowData {
  suggestions: string[]
  rowIndex: number
}

// Build rows of suggestions for flex-based layout
function buildRows(suggestions: string[]): RowData[] {
  if (suggestions.length === 0) return []

  const rows: RowData[] = []

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++) {
    // Stagger start index per row using golden ratio to avoid vertical alignment
    const startIdx = Math.floor(rowIndex * 0.618033988749 * suggestions.length) % suggestions.length
    const rowSuggestions: string[] = []

    for (let i = 0; i < CHIPS_PER_ROW; i++) {
      const idx = (startIdx + i) % suggestions.length
      rowSuggestions.push(suggestions[idx])
    }

    rows.push({ suggestions: rowSuggestions, rowIndex })
  }

  return rows
}

// Random shuffle - stochastic each page load
function shuffle<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export default function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { theme } = useThemeStore()
  const { language, setLanguage } = useSettingsStore()
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const offsetRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const hasDraggedRef = useRef(false)
  const lastPinchDistRef = useRef<number | null>(null)
  const [selectedTraits, setSelectedTraits] = useState<Set<TraitId>>(new Set())

  // Get trait labels for mixing into suggestions
  const traitLabels = traits.map(t => t.label)

  // Shuffled base list - random on each page load
  const shuffledBase = useMemo(() => {
    const allWithCategories = [...allSuggestions, ...traitLabels]
    const shuffled = shuffle(allWithCategories)

    // Keep "Fund mutual aid" and "Start mutual fund" adjacent (fun wordplay)
    const mutualAidIdx = shuffled.indexOf('Fund mutual aid')
    const mutualFundIdx = shuffled.indexOf('Start mutual fund')
    if (mutualAidIdx !== -1 && mutualFundIdx !== -1 && Math.abs(mutualAidIdx - mutualFundIdx) > 1) {
      // Move mutual fund right after mutual aid
      shuffled.splice(mutualFundIdx, 1)
      const newAidIdx = shuffled.indexOf('Fund mutual aid')
      shuffled.splice(newAidIdx + 1, 0, 'Start mutual fund')
    }

    return shuffled
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps = shuffle once on mount

  // Filter suggestions based on selected traits
  const filteredSuggestions = useMemo(() => {
    if (selectedTraits.size === 0) return shuffledBase

    // When filtering, get keyword-matched suggestions but HIDE ID chips
    const filtered = shuffledBase.filter(suggestion => {
      const matchingTrait = traits.find(t => t.label === suggestion)
      if (matchingTrait) {
        return false // Hide all ID chips when filtering
      }

      // Regular suggestion must match ALL selected traits (intersection)
      return Array.from(selectedTraits).every(traitId => {
        const trait = traits.find(t => t.id === traitId)
        return trait && suggestionMatchesTrait(suggestion, trait)
      })
    })

    return filtered
  }, [selectedTraits, shuffledBase])

  const toggleTrait = useCallback((traitId: TraitId) => {
    setSelectedTraits(prev => {
      const next = new Set(prev)
      if (next.has(traitId)) {
        next.delete(traitId)
      } else {
        next.add(traitId)
      }
      return next
    })
  }, [])

  // Build rows from filtered suggestions
  const rows = useMemo(() => buildRows(filteredSuggestions), [filteredSuggestions])

  // Track container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // Use refs + document-level listeners for reliable dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      const newOffset = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Handle pinch-to-zoom with 2 fingers
      if (e.touches.length === 2) {
        e.preventDefault()
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)

        if (lastPinchDistRef.current !== null) {
          const delta = dist - lastPinchDistRef.current
          const zoomSpeed = 0.012
          const newScale = Math.max(0.3, Math.min(3, scaleRef.current + delta * zoomSpeed))
          scaleRef.current = newScale
          setScale(newScale)
        }
        lastPinchDistRef.current = dist
        return
      }

      // Single finger drag
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      const touch = e.touches[0]
      const newOffset = {
        x: touch.clientX - dragStartRef.current.x,
        y: touch.clientY - dragStartRef.current.y,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
      lastPinchDistRef.current = null
    }

    // Wheel handler needs to be native to prevent browser zoom (passive: false)
    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd + scroll = zoom (prevent browser zoom)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const zoomSpeed = 0.008
        const newScale = Math.max(0.3, Math.min(3, scaleRef.current - e.deltaY * zoomSpeed))
        scaleRef.current = newScale
        setScale(newScale)
        return
      }

      // Regular scroll = pan
      const newOffset = {
        x: offsetRef.current.x - e.deltaX,
        y: offsetRef.current.y - e.deltaY,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const container = containerRef.current
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    container?.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      container?.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true
    hasDraggedRef.current = false
    dragStartRef.current = {
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y,
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    isDraggingRef.current = true
    hasDraggedRef.current = false
    dragStartRef.current = {
      x: touch.clientX - offsetRef.current.x,
      y: touch.clientY - offsetRef.current.y,
    }
  }

  const handleShuffle = () => {
    // Random jump to a new position
    const newOffset = {
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 1000 - 500,
    }
    offsetRef.current = newOffset
    setOffset(newOffset)
  }

  const handleResetZoom = () => {
    scaleRef.current = 1
    setScale(1)
  }

  const handleChipClick = (suggestion: string) => {
    // Only trigger click if we didn't drag
    if (hasDraggedRef.current) return

    // Check if this is a category chip
    const matchingTrait = traits.find(t => t.label === suggestion)
    if (matchingTrait) {
      toggleTrait(matchingTrait.id)
      return
    }

    onSuggestionClick(suggestion)
  }

  // Check if a string is a category chip
  const isCategory = (text: string) => traits.some(t => t.label === text)

  return (
    <div className="flex-1 relative h-full overflow-hidden">
      {/* Selected categories - top left */}
      {selectedTraits.size > 0 && (
        <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
          {Array.from(selectedTraits).map(traitId => {
            const trait = traits.find(t => t.id === traitId)
            if (!trait) return null
            return (
              <button
                key={traitId}
                onClick={() => toggleTrait(traitId)}
                className={`px-3 py-2 text-sm border flex items-center gap-2 transition-colors ${
                  theme === 'dark'
                    ? 'bg-juice-dark/80 backdrop-blur-sm border-juice-orange text-juice-orange hover:bg-juice-dark'
                    : 'bg-white/80 backdrop-blur-sm border-juice-orange text-orange-700 hover:bg-white'
                }`}
              >
                {trait.label}
                <span className="text-xs opacity-60">×</span>
              </button>
            )
          })}
          <span className={`text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {filteredSuggestions.length} matches
          </span>
        </div>
      )}

      {/* Full-width chips canvas (background layer) */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing select-none overflow-hidden"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'none' }}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {(() => {
            // Total grid height
            const tileHeight = ROW_COUNT * CHIP_HEIGHT

            // Viewport bounds in scaled coordinates
            const viewTop = -offset.y / scale - containerSize.height / 2 / scale
            const viewBottom = -offset.y / scale + containerSize.height / 2 / scale

            // Determine which row tiles are visible (vertical tiling)
            const minTileY = Math.floor((viewTop + tileHeight / 2) / tileHeight)
            const maxTileY = Math.ceil((viewBottom + tileHeight / 2) / tileHeight)

            // Limit tiles when zoomed out
            const maxTiles = scale < 0.3 ? 1 : scale < 0.5 ? 2 : scale < 0.8 ? 3 : 4
            const clampedMinTileY = Math.max(minTileY, -maxTiles)
            const clampedMaxTileY = Math.min(maxTileY, maxTiles)

            const visibleRows: JSX.Element[] = []

            for (let ty = clampedMinTileY; ty <= clampedMaxTileY; ty++) {
              for (const row of rows) {
                const rowY = row.rowIndex * CHIP_HEIGHT - tileHeight / 2 + ty * tileHeight

                // Skip rows outside visible area
                if (rowY + CHIP_HEIGHT < viewTop - 100 || rowY > viewBottom + 100) continue

                const screenY = containerSize.height / 2 + rowY
                // Stagger each row using golden ratio for pleasing visual offset
                const rowStagger = (row.rowIndex * 0.618033988749 * 200) % 400 - 200

                visibleRows.push(
                  <div
                    key={`${ty}_${row.rowIndex}`}
                    className="absolute flex"
                    style={{
                      top: screenY,
                      height: CHIP_HEIGHT,
                      // Start from far left, offset based on pan + row stagger
                      left: -5000,
                      transform: `translateX(${offset.x % 5000 + rowStagger}px)`,
                    }}
                  >
                    {/* Render chips multiple times for horizontal tiling to fill space */}
                    {[0, 1, 2, 3, 4].map(tileX => (
                      <div key={tileX} className="flex">
                        {row.suggestions.map((suggestion, chipIdx) => {
                          const isCategoryChip = isCategory(suggestion)
                          const isPopular = popularSuggestions.has(suggestion)
                          const isPro = proSuggestions.has(suggestion)
                          const isDemo = demoSuggestions.has(suggestion)
                          const isFun = funSuggestions.has(suggestion)
                          const isBold = boldSuggestions.has(suggestion)

                          return (
                            <button
                              key={`${tileX}_${chipIdx}`}
                              onMouseUp={() => handleChipClick(suggestion)}
                              onTouchEnd={() => handleChipClick(suggestion)}
                              className={`px-3 py-2 border text-sm whitespace-nowrap select-none flex items-center gap-2 transition-[background-color,border-color,color] duration-100 ${
                                isCategoryChip
                                  ? theme === 'dark'
                                    ? 'bg-yellow-500/20 border-yellow-400/50 text-yellow-300 font-medium hover:bg-yellow-500/35 hover:border-yellow-400'
                                    : 'bg-yellow-50 border-yellow-500/50 text-yellow-700 font-medium hover:bg-yellow-100 hover:border-yellow-500'
                                  : isBold
                                    ? theme === 'dark'
                                      ? 'bg-purple-500/25 border-purple-400/50 text-purple-300 hover:bg-purple-500/40 hover:border-purple-400'
                                      : 'bg-purple-50 border-purple-400/50 text-purple-700 hover:bg-purple-100 hover:border-purple-500'
                                    : isPopular
                                      ? theme === 'dark'
                                        ? 'bg-juice-cyan/20 border-juice-cyan/40 text-juice-cyan hover:bg-juice-cyan/35 hover:border-juice-cyan'
                                        : 'bg-juice-cyan/10 border-juice-cyan/50 text-teal-700 hover:bg-juice-cyan/20 hover:border-teal-500'
                                      : isPro
                                        ? theme === 'dark'
                                          ? 'bg-juice-orange/20 border-juice-orange/40 text-juice-orange hover:bg-juice-orange/35 hover:border-juice-orange'
                                          : 'bg-orange-50 border-juice-orange/50 text-orange-700 hover:bg-orange-100 hover:border-orange-500'
                                        : isDemo
                                          ? theme === 'dark'
                                            ? 'bg-pink-500/20 border-pink-400/40 text-pink-300 hover:bg-pink-500/35 hover:border-pink-400'
                                            : 'bg-pink-50 border-pink-400/50 text-pink-700 hover:bg-pink-100 hover:border-pink-500'
                                          : isFun
                                            ? theme === 'dark'
                                              ? 'bg-green-500/20 border-green-400/40 text-green-300 hover:bg-green-500/35 hover:border-green-400'
                                              : 'bg-green-50 border-green-400/50 text-green-700 hover:bg-green-100 hover:border-green-500'
                                            : theme === 'dark'
                                              ? 'bg-gray-700/50 border-white/10 text-gray-300 hover:bg-gray-600/60 hover:border-white/25 hover:text-white'
                                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900'
                              }`}
                              style={{ height: CHIP_HEIGHT }}
                            >
                              {suggestion}
                              {/* Only show the PRIMARY badge */}
                              {isCategoryChip ? (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-yellow-400">
                                  id
                                </span>
                              ) : isBold ? (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-purple-400">
                                  bold
                                </span>
                              ) : isPopular ? (
                                <span className="text-[10px] uppercase tracking-wide text-juice-cyan/70">
                                  popular
                                </span>
                              ) : isPro ? (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-yellow-400">
                                  pro
                                </span>
                              ) : isDemo ? (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-pink-400">
                                  demo
                                </span>
                              ) : isFun ? (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-green-400">
                                  fun
                                </span>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )
              }
            }

            return visibleRows
          })()}
        </div>
      </div>

      {/* Shuffle, Zoom & Language controls - top right of recommendations area */}
      <div className="absolute top-4 right-4 flex gap-2 z-50">
        {/* Language selector */}
        <div className="relative">
          <button
            onClick={() => setLangMenuOpen(!langMenuOpen)}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/80 backdrop-blur-sm'
                : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/80 backdrop-blur-sm'
            }`}
          >
            {LANGUAGES.find(l => l.code === language)?.native || 'English'}
          </button>
          {langMenuOpen && (
            <div
              className={`absolute top-full right-0 mt-1 py-1 border shadow-lg max-h-64 overflow-y-auto ${
                theme === 'dark'
                  ? 'bg-juice-dark border-white/20'
                  : 'bg-white border-gray-200'
              }`}
              onMouseLeave={() => setLangMenuOpen(false)}
            >
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code)
                    setLangMenuOpen(false)
                  }}
                  className={`w-full px-4 py-2 text-sm text-left whitespace-nowrap transition-colors ${
                    language === lang.code
                      ? theme === 'dark'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-green-50 text-green-700'
                      : theme === 'dark'
                        ? 'text-white/80 hover:bg-white/10'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {lang.native}
                </button>
              ))}
            </div>
          )}
        </div>

        {scale !== 1 && (
          <button
            onClick={handleResetZoom}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/80 backdrop-blur-sm'
                : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/80 backdrop-blur-sm'
            }`}
          >
            {Math.round(scale * 100)}%
          </button>
        )}
        <button
          onClick={handleShuffle}
          className={`px-3 py-1.5 text-sm border transition-colors ${
            theme === 'dark'
              ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/80 backdrop-blur-sm'
              : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/80 backdrop-blur-sm'
          }`}
        >
          Shuffle
        </button>
      </div>
    </div>
  )
}
