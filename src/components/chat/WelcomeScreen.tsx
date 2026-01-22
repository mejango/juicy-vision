import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
}

// Identity traits for filtering - empathetic, human-centered
type TraitId = 'maker' | 'artist' | 'community' | 'supporter' | 'visionary' | 'coder' | 'changemaker' | 'entrepreneur' | 'gamer' | 'researcher' | 'local' | 'curious' | 'dreamer' | 'rebel' | 'degen' | 'introvert' | 'chaotic' | 'normie' | 'rich' | 'giving' | 'lazy' | 'famous' | 'anon' | 'touched-grass' | 'climate' | 'health' | 'creative' | 'food' | 'science' | 'ai' | 'web3'

// Map English suggestion text -> i18n key (for suggestions that have translations)
const suggestionKeyMap: Record<string, string> = {
  'What is Juicy?': 'whatIsJuicy',
  'How do I start a fundraiser?': 'howDoIStartAFundraiser',
  'How can I start a business?': 'howCanIStartABusiness',
  'Help me plan my fundraise': 'helpMePlanMyFundraise',
  'Is it free to create a project?': 'isItFreeToCreateAProject',
  'What can I build with Juicy?': 'whatCanIBuildWithJuicy',
  'Show me how it works': 'showMeHowItWorks',
  'Walk me through the basics': 'walkMeThroughTheBasics',
  'What makes Juicy different?': 'whatMakesJuicyDifferent',
  'How does the money flow?': 'howDoesTheMoneyFlow',
  'Show me successful projects': 'showMeSuccessfulProjects',
  'Show me trending projects': 'showMeTrendingProjects',
  'Show me biggest projects right now': 'showMeBiggestProjects',
  'Show me creative projects': 'showMeCreativeProjects',
  'What are people building?': 'whatArePeopleBuilding',
  'Show me weird projects': 'showMeWeirdProjects',
  'Find something inspiring': 'findSomethingInspiring',
  'Show me projects like mine': 'showMeProjectsLikeMine',
  'What launched this week?': 'whatLaunchedThisWeek',
  'Show me underfunded gems': 'showMeUnderfundedGems',
  'Find a project to support': 'findAProjectToSupport',
  'What projects need funding?': 'whatProjectsNeedFunding',
  'Show me projects I can pay into': 'showMeProjectsICanPayInto',
  'Support an open source project': 'supportAnOpenSourceProject',
  'Back an indie developer': 'backAnIndieDeveloper',
  'Find projects by category': 'findProjectsByCategory',
  'Discover new projects': 'discoverNewProjects',
  'Fund my open source library': 'fundMyOpenSourceLibrary',
  'Sustain my GitHub project': 'sustainMyGitHubProject',
  'Bootstrap my startup': 'bootstrapMyStartup',
  'Launch my small business': 'launchMySmallBusiness',
  'Fund my side project': 'fundMySideProject',
  'Start my billion dollar business': 'startMyBillionDollarBusiness',
  'Build the next unicorn': 'buildTheNextUnicorn',
  'Launch my empire': 'launchMyEmpire',
  'Fund world domination': 'fundWorldDomination',
  'Create generational wealth': 'createGenerationalWealth',
  'Build something that outlives me': 'buildSomethingThatOutlivesMe',
  'Start a movement': 'startAMovement',
  'Change an industry': 'changeAnIndustry',
  'Disrupt everything': 'disruptEverything',
  'Run a community fundraiser': 'runACommunityFundraiser',
  'Organize a charity drive': 'organizeACharityDrive',
  'Fund disaster relief': 'fundDisasterRelief',
  'Fund mutual aid': 'fundMutualAid',
  'Fund my album': 'fundMyAlbum',
  'Launch my music project': 'launchMyMusicProject',
  'Fund my podcast': 'fundMyPodcast',
  'Fund my indie game': 'fundMyIndieGame',
  'Crowdfund my film': 'crowdfundMyFilm',
  'Fund my art collective': 'fundMyArtCollective',
  'Support my webcomic': 'supportMyWebcomic',
  'Launch my animation project': 'launchMyAnimationProject',
  'Fund my documentary': 'fundMyDocumentary',
  'Fund my newsletter': 'fundMyNewsletter',
  'Support my journalism': 'supportMyJournalism',
  'Fund my book': 'fundMyBook',
  'Fund my weird art project': 'fundMyWeirdArtProject',
  'Start a meme coin with utility': 'startAMemeCoinWithUtility',
  'Fund my research': 'fundMyResearch',
  'Support my course': 'supportMyCourse',
  'Fund my tutorial series': 'fundMyTutorialSeries',
  'Fund my esports team': 'fundMyEsportsTeam',
  'Launch my gaming community': 'launchMyGamingCommunity',
  'Can I run a membership program?': 'canIRunAMembershipProgram',
  'Start a fan club': 'startAFanClub',
  'Build a paid community': 'buildAPaidCommunity',
  'Fund my community garden': 'fundMyCommunityGarden',
  'Fund my community center': 'fundMyCommunityCenter',
  'Start a neighborhood project': 'startANeighborhoodProject',
  'Launch my food truck': 'launchMyFoodTruck',
  'Fund my cat cafe': 'fundMyCatCafe',
  'Fund my coworking space': 'fundMyCoworkingSpace',
  'Start my hackerspace': 'startMyHackerspace',
  'How do supporters get rewarded?': 'howDoSupportersGetRewarded',
  'How can I reward supporters?': 'howCanIRewardSupporters',
  'Can supporters cash out?': 'canSupportersCashOut',
  'How do I whitelabel Juicy?': 'howDoIWhitelabelJuicy',
  'Create a grants program': 'createAGrantsProgram',
  'Run a retroactive funding round': 'runARetroactiveFundingRound',
  'Create a quadratic funding pool': 'createAQuadraticFundingPool',
  'Launch a revnet': 'launchARevnet',
  'Fund public goods': 'fundPublicGoods',
  'Fund protocol development': 'fundProtocolDevelopment',
  'Build an automated revenue machine': 'buildAnAutomatedRevenueMachine',
  'Create a self-sustaining treasury': 'createASelfSustainingTreasury',
  'Launch a perpetual funding engine': 'launchAPerpetualFundingEngine',
  'Money that works while I sleep': 'moneyThatWorksWhileISleep',
  'Build a prediction game on Juicebox': 'buildAPredictionGameOnJuicebox',
  'Create a tournament with prize pools': 'createATournamentWithPrizePools',
  'Build a betting pool for my friends': 'buildABettingPoolForMyFriends',
  'Show me a live fundraise': 'showMeALiveFundraise',
  'Pay into a project': 'payIntoAProject',
  'Create a simple project': 'createASimpleProject',
  'Walk me through a payment': 'walkMeThroughAPayment',
  'Show me cash out in action': 'showMeCashOutInAction',
  'Tell me a success story': 'tellMeASuccessStory',
  'What could go right?': 'whatCouldGoRight',
  'Inspire me': 'inspireMe',
  'Dream big with me': 'dreamBigWithMe',
  "What if money wasn't the problem?": 'whatIfMoneyWasntTheProblem',
  'Help me think bigger': 'helpMeThinkBigger',
  "Show me what's possible": 'showMeWhatsPossible',
  'Fund my YouTube channel': 'fundMyYouTubeChannel',
  'Monetize my expertise': 'monetizeMyExpertise',
  'Fund my online course': 'fundMyOnlineCourse',
  'Build my personal brand': 'buildMyPersonalBrand',
  'Fund my AI startup': 'fundMyAIStartup',
  'Build AI-powered tools': 'buildAIPoweredTools',
  'Build an AI agent': 'buildAnAIAgent',
  'Fund my climate tech': 'fundMyClimateTech',
  'Fund my solar project': 'fundMySolarProject',
  'Fund my health tech': 'fundMyHealthTech',
  'Build mental health app': 'buildMentalHealthApp',
  'Launch my wellness platform': 'launchMyWellnessPlatform',
  'Fund my social app': 'fundMySocialApp',
  'Launch my productivity app': 'launchMyProductivityApp',
  'Fund my online community': 'fundMyOnlineCommunity',
  'Build a membership platform': 'buildAMembershipPlatform',
  'Fund my restaurant': 'fundMyRestaurant',
  'Launch my coffee roaster': 'launchMyCoffeeRoaster',
  'Fund my brewery': 'fundMyBrewery',
  'Fund my fashion brand': 'fundMyFashionBrand',
  'Launch my streetwear': 'launchMyStreetwear',
  'Fund my sports team': 'fundMySportsTeam',
  'Fund my film': 'fundMyFilm',
  // Discovery
  'Support a creator I follow': 'supportACreatorIFollow',
  'Find Ethereum projects': 'findEthereumProjects',
  'Show me Base projects': 'showMeBaseProjects',
  'Projects on Optimism': 'projectsOnOptimism',
  'Projects on Arbitrum': 'projectsOnArbitrum',
  'Find projects in my city': 'findProjectsInMyCity',
  'Show me climate projects': 'showMeClimateProjects',
  'Find education projects': 'findEducationProjects',
  // Developer tools
  'Get paid for my npm package': 'getPaidForMyNpmPackage',
  'Fund my dev tools': 'fundMyDevTools',
  'Support protocol development': 'supportProtocolDevelopment',
  'Fund infrastructure I maintain': 'fundInfrastructureIMaintain',
  'Get sponsors for my framework': 'getSponsorsForMyFramework',
  'Fund my VS Code extension': 'fundMyVSCodeExtension',
  'Monetize my API': 'monetizeMyAPI',
  'Fund my CLI tool': 'fundMyCLITool',
  'Fund my database project': 'fundMyDatabaseProject',
  'Support my security research': 'supportMySecurityResearch',
  'Fund my compiler': 'fundMyCompiler',
  'Maintain critical infrastructure': 'maintainCriticalInfrastructure',
  'Fund my programming language': 'fundMyProgrammingLanguage',
  // Ambitious
  'Go from zero to IPO': 'goFromZeroToIPO',
  'Build my legacy': 'buildMyLegacy',
  'Replace a broken system': 'replaceABrokenSystem',
  'Fund the future I want to see': 'fundTheFutureIWantToSee',
  'Build critical infrastructure': 'buildCriticalInfrastructure',
  'Create a new category': 'createANewCategory',
  // Business
  'Start a worker-owned co-op': 'startAWorkerOwnedCoop',
  'Fund my hardware startup': 'fundMyHardwareStartup',
  'Launch a collective business': 'launchACollectiveBusiness',
  'Start my consulting firm': 'startMyConsultingFirm',
  'Fund my SaaS product': 'fundMySaaSProduct',
  'Launch my marketplace': 'launchMyMarketplace',
  'Fund my physical product': 'fundMyPhysicalProduct',
  'Start my agency': 'startMyAgency',
  'Fund my franchise': 'fundMyFranchise',
  'Launch my service business': 'launchMyServiceBusiness',
  'Fund my subscription business': 'fundMySubscriptionBusiness',
  // Investment
  'How do I split ownership?': 'howDoISplitOwnership',
  'How can I make agreements with investors?': 'howCanIMakeAgreementsWithInvestors',
  'How do I share revenue with backers?': 'howDoIShareRevenueWithBackers',
  'Create investor agreements': 'createInvestorAgreements',
  'Set up revenue sharing': 'setUpRevenueSharing',
  'Configure profit distribution': 'configureProfitDistribution',
  'Manage cap table on-chain': 'manageCapTableOnChain',
  'Create vesting schedules': 'createVestingSchedules',
  'Set up milestone payments': 'setUpMilestonePayments',
  // Fundraising
  'Make an auditable political campaign': 'makeAnAuditablePoliticalCampaign',
  'Fund a local initiative': 'fundALocalInitiative',
  'Run a matching campaign': 'runAMatchingCampaign',
  'Launch a crowdfund with deadline': 'launchACrowdfundWithDeadline',
  'Set up recurring donations': 'setUpRecurringDonations',
  'Create a giving circle': 'createAGivingCircle',
  'Start mutual fund': 'startMutualFund',
  // Music & Audio
  'Start my record label': 'startMyRecordLabel',
  'Fund my audio drama': 'fundMyAudioDrama',
  'Launch my radio show': 'launchMyRadioShow',
  'Fund my sound design studio': 'fundMySoundDesignStudio',
  'Support my music venue': 'supportMyMusicVenue',
  // Visual
  'Launch my photography project': 'launchMyPhotographyProject',
  'Fund my VR experience': 'fundMyVRExperience',
  'Support my NFT collection': 'supportMyNFTCollection',
  'Fund my gallery': 'fundMyGallery',
  // Written
  'Launch my magazine': 'launchMyMagazine',
  'Fund investigative reporting': 'fundInvestigativeReporting',
  'Support my blog': 'supportMyBlog',
  'Fund my zine': 'fundMyZine',
  'Launch my publishing house': 'launchMyPublishingHouse',
  'Fund my translation project': 'fundMyTranslationProject',
  'Support independent media': 'supportIndependentMedia',
  // Weird & Wonderful
  'Fund my experimental theater': 'fundMyExperimentalTheater',
  'Launch my puppet show': 'launchMyPuppetShow',
  'Fund my street performance': 'fundMyStreetPerformance',
  'Fund my escape room': 'fundMyEscapeRoom',
  'Launch my pirate ship bar': 'launchMyPirateShipBar',
  'Fund my immersive experience': 'fundMyImmersiveExperience',
  'Start my mystery dinner theater': 'startMyMysteryDinnerTheater',
  'Fund my haunted house': 'fundMyHauntedHouse',
  'Launch my themed restaurant': 'launchMyThemedRestaurant',
  'Fund my artistic protest': 'fundMyArtisticProtest',
  // Education
  'Launch my bootcamp': 'launchMyBootcamp',
  'Fund my educational content': 'fundMyEducationalContent',
  'Support my mentorship program': 'supportMyMentorshipProgram',
  'Fund my thesis': 'fundMyThesis',
  'Launch my learning platform': 'launchMyLearningPlatform',
  'Fund my scholarship program': 'fundMyScholarshipProgram',
  'Support my lab': 'supportMyLab',
  'Fund my field research': 'fundMyFieldResearch',
  'Launch my workshop series': 'launchMyWorkshopSeries',
  // Community + Education + Business
  'Start a community bootcamp business': 'startACommunityBootcampBusiness',
  'Launch a cohort-based course with membership': 'launchACohortBasedCourseWithMembership',
  'Build a paid learning community': 'buildAPaidLearningCommunity',
  'Start a tutoring collective': 'startATutoringCollective',
  'Launch a coding bootcamp for my community': 'launchACodingBootcampForMyCommunity',
  'Build a community education startup': 'buildACommunityEducationStartup',
  'Start a membership-based workshop business': 'startAMembershipBasedWorkshopBusiness',
  'Fund my community teaching studio': 'fundMyCommunityTeachingStudio',
  'Launch a local skills training business': 'launchALocalSkillsTrainingBusiness',
  'Build an education co-op': 'buildAnEducationCoop',
  'Start a neighborhood tutoring business': 'startANeighborhoodTutoringBusiness',
  'Launch a community apprenticeship program': 'launchACommunityApprenticeshipProgram',
  'Build a peer learning membership': 'buildAPeerLearningMembership',
  'Start a community mentorship business': 'startACommunityMentorshipBusiness',
  'Fund my teaching collective': 'fundMyTeachingCollective',
  // Gaming
  'Fund my speedrun project': 'fundMySpeedrunProject',
  'Support my mod development': 'supportMyModDevelopment',
  'Fund my game server': 'fundMyGameServer',
  'Launch my tournament series': 'launchMyTournamentSeries',
  'Fund my game studio': 'fundMyGameStudio',
  'Support my streaming setup': 'supportMyStreamingSetup',
  'Fund my board game': 'fundMyBoardGame',
  'Launch my arcade': 'launchMyArcade',
  // Community & Social
  'Can I fundraise for a collective?': 'canIFundraiseForACollective',
  'Run a discord with benefits': 'runADiscordWithBenefits',
  'Start a buying club': 'startABuyingClub',
  'Launch a tool library': 'launchAToolLibrary',
  'Fund my community kitchen': 'fundMyCommunityKitchen',
  'Launch my social club': 'launchMySocialClub',
  // Local & IRL
  'Fund my local park cleanup': 'fundMyLocalParkCleanup',
  'Launch a community fridge': 'launchACommunityFridge',
  'Fund my bike repair collective': 'fundMyBikeRepairCollective',
  'Start a free store': 'startAFreeStore',
  'Fund my community workshop': 'fundMyCommunityWorkshop',
  'Crowdfund my tattoo shop': 'crowdfundMyTattooShop',
  'Fund my urban garden': 'fundMyUrbanGarden',
  'Start my vintage arcade': 'startMyVintageArcade',
  'Start my maker space': 'startMyMakerSpace',
  'Fund my community radio': 'fundMyCommunityRadio',
  'Launch my skate park': 'launchMySkatePark',
  'Fund my climbing gym': 'fundMyClimbingGym',
  // Operations
  'How do I withdraw funds?': 'howDoIWithdrawFunds',
  'How transparent is the funding?': 'howTransparentIsTheFunding',
  'How do refunds work?': 'howDoRefundsWork',
  'Can I set funding goals?': 'canISetFundingGoals',
  'How do I add team members?': 'howDoIAddTeamMembers',
  'How do I update my project?': 'howDoIUpdateMyProject',
  // Platform & Infrastructure
  'Create a fundraising platform': 'createAFundraisingPlatform',
  'Build my own crowdfunding site': 'buildMyOwnCrowdfundingSite',
  'Embed fundraising in my app': 'embedFundraisingInMyApp',
  'White-label fund management': 'whiteLabelFundManagement',
  'Build a giving platform': 'buildAGivingPlatform',
  'Run fundraisers for my community': 'runFundraisersForMyCommunity',
  'Host multiple projects on my site': 'hostMultipleProjectsOnMySite',
  'Build a philanthropy dashboard': 'buildAPhilanthropyDashboard',
  'Create an impact marketplace': 'createAnImpactMarketplace',
  // Advanced
  'Custom branding for my platform': 'customBrandingForMyPlatform',
  'Launch a network state project': 'launchANetworkStateProject',
  'Set up cross-chain fundraising': 'setUpCrossChainFundraising',
  'Create programmable payouts': 'createProgrammablePayouts',
  'Build custom approval flows': 'buildCustomApprovalFlows',
  'Configure complex splits': 'configureComplexSplits',
  'Set up staged releases': 'setUpStagedReleases',
  // Crypto Native
  'Launch a token for my project': 'launchATokenForMyProject',
  'Create a treasury for my group': 'createATreasuryForMyGroup',
  'Set up on-chain governance': 'setUpOnChainGovernance',
  'Fund Ethereum infrastructure': 'fundEthereumInfrastructure',
  'Support blockchain research': 'supportBlockchainResearch',
  'Fund decentralization': 'fundDecentralization',
  'Build web3 public goods': 'buildWeb3PublicGoods',
  // Autonomous
  'Build an autonomous treasury': 'buildAnAutonomousTreasury',
  'Create a self-growing fund': 'createASelfGrowingFund',
  'Set up automated distributions': 'setUpAutomatedDistributions',
  'Create trustless payouts': 'createTrustlessPayouts',
  // JB Games
  'Create a sports bracket with real stakes': 'createASportsBracketWithRealStakes',
  'Launch a fantasy league with payouts': 'launchAFantasyLeagueWithPayouts',
  'Build a World Cup game like Defifa': 'buildAWorldCupGameLikeDefifa',
  'Make a prediction market game': 'makeAPredictionMarketGame',
  'Create a poker league treasury': 'createAPokerLeagueTreasury',
  'Build a coordination game': 'buildACoordinationGame',
  'Create a collective action mechanism': 'createACollectiveActionMechanism',
  'Launch a staking game': 'launchAStakingGame',
  'Build a commitment device': 'buildACommitmentDevice',
  'Create a savings game': 'createASavingsGame',
  'Launch a group challenge with stakes': 'launchAGroupChallengeWithStakes',
  'Build a bonding curve game': 'buildABondingCurveGame',
  'Create a token launch game': 'createATokenLaunchGame',
  'Design an economic experiment': 'designAnEconomicExperiment',
  'Build a market simulation': 'buildAMarketSimulation',
  'Create an auction game': 'createAnAuctionGame',
  'Launch a Dutch auction': 'launchADutchAuction',
  'Build a social token platform': 'buildASocialTokenPlatform',
  'Create a reputation system': 'createAReputationSystem',
  'Launch a governance game': 'launchAGovernanceGame',
  'Build a voting mechanism': 'buildAVotingMechanism',
  'Create a delegation market': 'createADelegationMarket',
  // JB Infrastructure
  "Use JB as my app's payment layer": 'useJBAsMyAppsPaymentLayer',
  'Build my app on Juicebox rails': 'buildMyAppOnJuiceboxRails',
  'JB as backend for my dapp': 'jbAsBackendForMyDapp',
  'Embed JB mechanics in my game': 'embedJBMechanicsInMyGame',
  'Use JB for in-game economies': 'useJBForInGameEconomies',
  'Build on JB primitives': 'buildOnJBPrimitives',
  // Demos
  'Demo the token mechanics': 'demoTheTokenMechanics',
  'Try a test transaction': 'tryATestTransaction',
  // Inspirational
  'What makes a project take off?': 'whatMakesAProjectTakeOff',
  'What would you fund?': 'whatWouldYouFund',
  "Who's doing it right?": 'whosDoingItRight',
  // Lazy
  'Make money while I sleep': 'makeMoneyWhileISleep',
  'Set it and forget it treasury': 'setItAndForgetItTreasury',
  'Passive income on autopilot': 'passiveIncomeOnAutopilot',
  'Zero maintenance fundraising': 'zeroMaintenanceFundraising',
  'Let the code do the work': 'letTheCodeDoTheWork',
  'Automated revenue streams': 'automatedRevenueStreams',
  'Trustless income machine': 'trustlessIncomeMachine',
  'Self-running project': 'selfRunningProject',
  'Hands-off treasury management': 'handsOffTreasuryManagement',
  'Perpetual motion money': 'perpetualMotionMoney',
  'Fire and forget funding': 'fireAndForgetFunding',
  'Run a project from my couch': 'runAProjectFromMyCouch',
  'Minimal effort maximum returns': 'minimalEffortMaximumReturns',
  'Automate my side hustle': 'automateMySideHustle',
  'Build once collect forever': 'buildOnceCollectForever',
  'No meetings required': 'noMeetingsRequired',
  'Async-first treasury': 'asyncFirstTreasury',
  'Let smart contracts handle it': 'letSmartContractsHandleIt',
  'Programmable passive income': 'programmablePassiveIncome',
  'Self-sustaining without me': 'selfSustainingWithoutMe',
  // Degen
  'Ape into something new': 'apeIntoSomethingNew',
  'Launch a meme treasury': 'launchAMemeTreasury',
  'Degen funding pool': 'degenFundingPool',
  'High risk high reward project': 'highRiskHighRewardProject',
  'Ponzinomics but ethical': 'ponzinomicsButEthical',
  'Token go up treasury': 'tokenGoUpTreasury',
  'Betting pool for degens': 'bettingPoolForDegens',
  'Prediction market mayhem': 'predictionMarketMayhem',
  'Fantasy sports with real stakes': 'fantasySportsWithRealStakes',
  'Arcade token economy': 'arcadeTokenEconomy',
  'Bonding curve experiments': 'bondingCurveExperiments',
  'Revnet for the culture': 'revnetForTheCulture',
  'Gamified treasury': 'gamifiedTreasury',
  'Speculation station': 'speculationStation',
  'Diamond hands treasury': 'diamondHandsTreasury',
  'WAGMI fund': 'wagmiFund',
  'To the moon project': 'toTheMoonProject',
  'Degen collective treasury': 'degenCollectiveTreasury',
  'Floor price treasury': 'floorPriceTreasury',
  'Mint and pray': 'mintAndPray',
  // Chaotic
  'Fund beautiful chaos': 'fundBeautifulChaos',
  'Weird experiment treasury': 'weirdExperimentTreasury',
  'Chaotic good funding': 'chaoticGoodFunding',
  'Disrupt for fun': 'disruptForFun',
  'Meme lord treasury': 'memeLordTreasury',
  'Absurdist art fund': 'absurdistArtFund',
  'Chaos magic project': 'chaosMagicProject',
  'Random acts of funding': 'randomActsOfFunding',
  'Experimental mayhem': 'experimentalMayhem',
  'Pirate radio treasury': 'pirateRadioTreasury',
  'Underground weird stuff': 'undergroundWeirdStuff',
  'Subversive art collective': 'subversiveArtCollective',
  'Anarchy but organized': 'anarchyButOrganized',
  'Controlled demolition fund': 'controlledDemolitionFund',
  'Creative destruction treasury': 'creativeDestructionTreasury',
  'Break things beautifully': 'breakThingsBeautifully',
  'Fund the inexplicable': 'fundTheInexplicable',
  'Mystery box treasury': 'mysteryBoxTreasury',
  'Haunted house collective': 'hauntedHouseCollective',
  'Immersive chaos experience': 'immersiveChaosExperience',
  // Rich
  'Path to my first million': 'pathToMyFirstMillion',
  'Wealth building machine': 'wealthBuildingMachine',
  'Empire starts here': 'empireStartsHere',
  'From broke to rich': 'fromBrokeToRich',
  'Revenue maximization': 'revenueMaximization',
  'Profit-first treasury': 'profitFirstTreasury',
  'Unicorn trajectory': 'unicornTrajectory',
  'IPO preparation fund': 'ipoPreparationFund',
  'Wealth accumulation engine': 'wealthAccumulationEngine',
  'Money printing operation': 'moneyPrintingOperation',
  'Bootstrap to billions': 'bootstrapToBillions',
  'Startup to acquisition': 'startupToAcquisition',
  'Revenue rocket ship': 'revenueRocketShip',
  'Profit margins on steroids': 'profitMarginsOnSteroids',
  'Wealth generation protocol': 'wealthGenerationProtocol',
  'Get rich systematically': 'getRichSystematically',
  'Million dollar project': 'millionDollarProject',
  'Exit strategy treasury': 'exitStrategyTreasury',
  'Compound wealth fund': 'compoundWealthFund',
  'Financial freedom machine': 'financialFreedomMachine',
  // Public Good
  'Fund public goods forever': 'fundPublicGoodsForever',
  'Open source sustainability': 'openSourceSustainability',
  'Free stuff for everyone': 'freeStuffForEveryone',
  'Community first always': 'communityFirstAlways',
  'Give it all away': 'giveItAllAway',
  'Mutual aid network': 'mutualAidNetwork',
  'Scholarship for strangers': 'scholarshipForStrangers',
  'Relief fund for anyone': 'reliefFundForAnyone',
  'Charity without overhead': 'charityWithoutOverhead',
  'Free education treasury': 'freeEducationTreasury',
  'Commons funding pool': 'commonsFundingPool',
  'Nonprofit for coral reefs': 'nonprofitForCoralReefs',
  'Altruism as a service': 'altruismAsAService',
  'Help without expectation': 'helpWithoutExpectation',
  'Pure public benefit': 'purePublicBenefit',
  'Community wealth fund': 'communityWealthFund',
  'Share the wealth treasury': 'shareTheWealthTreasury',
  'Collective benefit pool': 'collectiveBenefitPool',
  'Free forever project': 'freeForeverProject',
  'Gift economy treasury': 'giftEconomyTreasury',
  // Anon
  'Anonymous treasury': 'anonymousTreasury',
  'Pseudonymous project': 'pseudonymousProject',
  'No KYC required': 'noKYCRequired',
  'Privacy-first funding': 'privacyFirstFunding',
  'Trustless and faceless': 'trustlessAndFaceless',
  'Anonymous collective': 'anonymousCollective',
  'Decentralized identity fund': 'decentralizedIdentityFund',
  'On-chain only presence': 'onChainOnlyPresence',
  'Protocol-native project': 'protocolNativeProject',
  'API-driven treasury': 'apiDrivenTreasury',
  'No doxxing allowed': 'noDoxxingAllowed',
  'Anonymous art fund': 'anonymousArtFund',
  'Pseudonymous media outlet': 'pseudonymousMediaOutlet',
  'Privacy-preserving treasury': 'privacyPreservingTreasury',
  'Autonomous collective': 'autonomousCollective',
  'Anon dev fund': 'anonDevFund',
  'Pseudonymous publishing': 'pseudonymousPublishing',
  'Anonymous research fund': 'anonymousResearchFund',
  'No-name collective': 'noNameCollective',
  'Shadow treasury': 'shadowTreasury',
  // Famous
  'Launch my media empire': 'launchMyMediaEmpire',
  'Viral content treasury': 'viralContentTreasury',
  'Influencer launch fund': 'influencerLaunchFund',
  'Famous overnight project': 'famousOvernightProject',
  'Content creator treasury': 'contentCreatorTreasury',
  'Streaming career fund': 'streamingCareerFund',
  'Podcast to millions': 'podcastToMillions',
  'Newsletter empire': 'newsletterEmpire',
  'Film festival fund': 'filmFestivalFund',
  'Documentary series treasury': 'documentarySeriesTreasury',
  'Music industry disruption': 'musicIndustryDisruption',
  'Album launch treasury': 'albumLaunchTreasury',
  'Media mogul starter': 'mediaMogulStarter',
  'Journalism that matters': 'journalismThatMatters',
  'Breaking news fund': 'breakingNewsFund',
  'Viral moment treasury': 'viralMomentTreasury',
  'Fame machine project': 'fameMachineProject',
  'Audience building fund': 'audienceBuildingFund',
  'Clout treasury': 'cloutTreasury',
  'Main character energy fund': 'mainCharacterEnergyFund',
  // Normie
  'Just a regular business': 'justARegularBusiness',
  'Normal small business fund': 'normalSmallBusinessFund',
  'Simple service business': 'simpleServiceBusiness',
  'Consulting practice treasury': 'consultingPracticeTreasury',
  'Agency starter fund': 'agencyStarterFund',
  'Coffee shop crowdfund': 'coffeeShopCrowdfund',
  'Food truck launch': 'foodTruckLaunch',
  'Tattoo parlor fund': 'tattooParlorFund',
  'Vintage shop treasury': 'vintageShopTreasury',
  'Climbing gym fund': 'climbingGymFund',
  'Skate shop starter': 'skateShopStarter',
  'Regular retail business': 'regularRetailBusiness',
  'Basic service company': 'basicServiceCompany',
  'Traditional business model': 'traditionalBusinessModel',
  'Simple honest work fund': 'simpleHonestWorkFund',
  'Main street business': 'mainStreetBusiness',
  'Neighborhood shop fund': 'neighborhoodShopFund',
  'Local service treasury': 'localServiceTreasury',
  'Family business fund': 'familyBusinessFund',
  'Classic entrepreneurship': 'classicEntrepreneurship',
  // Touch Grass
  'Touch grass treasury': 'touchGrassTreasury',
  'Outdoor project fund': 'outdoorProjectFund',
  'Nature connection fund': 'natureConnectionFund',
  'Local park improvement': 'localParkImprovement',
  'Community garden expansion': 'communityGardenExpansion',
  'Neighborhood beautification': 'neighborhoodBeautification',
  'Urban farming collective': 'urbanFarmingCollective',
  'Outdoor adventure fund': 'outdoorAdventureFund',
  'Trail maintenance treasury': 'trailMaintenanceTreasury',
  'Beach cleanup fund': 'beachCleanupFund',
  'River restoration project': 'riverRestorationProject',
  'Green space treasury': 'greenSpaceTreasury',
  'Fresh air collective': 'freshAirCollective',
  'Farmers market fund': 'farmersMarketFund',
  'Outdoor fitness treasury': 'outdoorFitnessTreasury',
  'Bike path project': 'bikePathProject',
  'Hiking club treasury': 'hikingClubTreasury',
  'Nature education fund': 'natureEducationFund',
  'Wildlife preservation': 'wildlifePreservation',
  'Outdoor community space': 'outdoorCommunitySpace',
  // Creator Economy
  'Launch my Twitch career': 'launchMyTwitchCareer',
  'Monetize my TikTok content': 'monetizeMyTikTokContent',
  'Fund my creator studio': 'fundMyCreatorStudio',
  'Launch my merch line': 'launchMyMerchLine',
  'Fund my content creation': 'fundMyContentCreation',
  'Start my Patreon alternative': 'startMyPatreonAlternative',
  'Build a creator collective': 'buildACreatorCollective',
  'Fund my video production': 'fundMyVideoProduction',
  'Launch my livestream setup': 'launchMyLivestreamSetup',
  'Fund my content house': 'fundMyContentHouse',
  'Start my media company': 'startMyMediaCompany',
  'Build my audience first': 'buildMyAudienceFirst',
  'Launch my coaching business': 'launchMyCoachingBusiness',
  'Build my speaking career': 'buildMySpeakingCareer',
  'Fund my brand deals': 'fundMyBrandDeals',
  'Create my creator fund': 'createMyCreatorFund',
  // Web3 & Crypto
  'Launch my token': 'launchMyToken',
  'Build a DAO from scratch': 'buildADAOFromScratch',
  'Create on-chain governance': 'createOnChainGovernance',
  'Fund my protocol': 'fundMyProtocol',
  'Build decentralized infrastructure': 'buildDecentralizedInfrastructure',
  'Launch my L2': 'launchMyL2',
  'Fund my rollup': 'fundMyRollup',
  'Build a bridge': 'buildABridge',
  'Create a DEX': 'createADEX',
  'Fund my wallet app': 'fundMyWalletApp',
  'Build an NFT marketplace': 'buildAnNFTMarketplace',
  'Launch my staking protocol': 'launchMyStakingProtocol',
  'Create a lending platform': 'createALendingPlatform',
  'Fund my oracle network': 'fundMyOracleNetwork',
  'Build a privacy protocol': 'buildAPrivacyProtocol',
  'Launch my identity solution': 'launchMyIdentitySolution',
  'Create a social graph': 'createASocialGraph',
  'Fund my data availability layer': 'fundMyDataAvailabilityLayer',
  'Build cross-chain tooling': 'buildCrossChainTooling',
  'Launch my MEV solution': 'launchMyMEVSolution',
  // AI & Tech
  'Train my own model': 'trainMyOwnModel',
  'Fund my ML research': 'fundMyMLResearch',
  'Create an AI assistant': 'createAnAIAssistant',
  'Build AI infrastructure': 'buildAIInfrastructure',
  'Fund my data company': 'fundMyDataCompany',
  'Launch my AI API': 'launchMyAIAPI',
  'Fund my robotics project': 'fundMyRoboticsProject',
  'Create autonomous systems': 'createAutonomousSystems',
  'Build my AI lab': 'buildMyAILab',
  'Fund my computer vision project': 'fundMyComputerVisionProject',
  'Launch my NLP startup': 'launchMyNLPStartup',
  'Build generative AI tools': 'buildGenerativeAITools',
  'Fund my AI hardware': 'fundMyAIHardware',
  'Create AI for good': 'createAIForGood',
  'Build ethical AI': 'buildEthicalAI',
  'Fund my AI safety research': 'fundMyAISafetyResearch',
  'Launch my AI studio': 'launchMyAIStudio',
  // Sustainability
  'Build renewable energy': 'buildRenewableEnergy',
  'Launch my carbon removal': 'launchMyCarbonRemoval',
  'Fund my reforestation': 'fundMyReforestation',
  'Create circular economy': 'createCircularEconomy',
  'Build sustainable fashion': 'buildSustainableFashion',
  'Fund my zero-waste business': 'fundMyZeroWasteBusiness',
  'Launch my recycling startup': 'launchMyRecyclingStartup',
  'Create sustainable packaging': 'createSustainablePackaging',
  'Fund my clean tech': 'fundMyCleanTech',
  'Build green infrastructure': 'buildGreenInfrastructure',
  'Launch my climate tech': 'launchMyClimateTech',
  'Fund my ocean cleanup': 'fundMyOceanCleanup',
  'Create sustainable agriculture': 'createSustainableAgriculture',
  'Build vertical farming': 'buildVerticalFarming',
  'Fund my food tech': 'fundMyFoodTech',
  'Launch my plant-based startup': 'launchMyPlantBasedStartup',
  'Create lab-grown products': 'createLabGrownProducts',
  'Fund my biodiversity project': 'fundMyBiodiversityProject',
  'Build regenerative systems': 'buildRegenerativeSystems',
  // Health & Wellness
  'Fund my fitness startup': 'fundMyFitnessStartup',
  'Create telehealth solution': 'createTelehealthSolution',
  'Build medical devices': 'buildMedicalDevices',
  'Fund my biotech research': 'fundMyBiotechResearch',
  'Launch my longevity project': 'launchMyLongevityProject',
  'Create personalized medicine': 'createPersonalizedMedicine',
  'Fund my diagnostics startup': 'fundMyDiagnosticsStartup',
  'Build health data platform': 'buildHealthDataPlatform',
  'Launch my therapy app': 'launchMyTherapyApp',
  'Fund my meditation startup': 'fundMyMeditationStartup',
  'Create sleep technology': 'createSleepTechnology',
  'Build nutrition platform': 'buildNutritionPlatform',
  'Fund my wearables company': 'fundMyWearablesCompany',
  'Launch my health community': 'launchMyHealthCommunity',
  'Create patient support': 'createPatientSupport',
  'Fund my clinical trials': 'fundMyClinicalTrials',
  'Build healthcare access': 'buildHealthcareAccess',
  // Finance & Fintech
  'Fund my neobank': 'fundMyNeobank',
  'Build payment infrastructure': 'buildPaymentInfrastructure',
  'Launch my investing app': 'launchMyInvestingApp',
  'Create savings platform': 'createSavingsPlatform',
  'Fund my insurance startup': 'fundMyInsuranceStartup',
  'Build credit solutions': 'buildCreditSolutions',
  'Launch my remittance service': 'launchMyRemittanceService',
  'Create financial education': 'createFinancialEducation',
  'Fund my trading platform': 'fundMyTradingPlatform',
  'Build wealth management': 'buildWealthManagement',
  'Launch my robo-advisor': 'launchMyRoboAdvisor',
  'Create expense tracking': 'createExpenseTracking',
  'Fund my accounting software': 'fundMyAccountingSoftware',
  'Build invoicing tools': 'buildInvoicingTools',
  'Launch my payroll startup': 'launchMyPayrollStartup',
  'Create tax solutions': 'createTaxSolutions',
  'Fund my lending startup': 'fundMyLendingStartup',
  'Build credit scoring': 'buildCreditScoring',
  'Launch my financial API': 'launchMyFinancialAPI',
  'Create embedded finance': 'createEmbeddedFinance',
  // Social Impact
  'Fund my nonprofit': 'fundMyNonprofit',
  'Build impact measurement': 'buildImpactMeasurement',
  'Launch my social enterprise': 'launchMySocialEnterprise',
  'Create employment programs': 'createEmploymentPrograms',
  'Fund my housing project': 'fundMyHousingProject',
  'Build affordable housing': 'buildAffordableHousing',
  'Launch my homeless solution': 'launchMyHomelessSolution',
  'Create food security': 'createFoodSecurity',
  'Fund my education nonprofit': 'fundMyEducationNonprofit',
  'Build literacy programs': 'buildLiteracyPrograms',
  'Launch my youth program': 'launchMyYouthProgram',
  'Create elder care': 'createElderCare',
  'Fund my disability services': 'fundMyDisabilityServices',
  'Build accessibility tools': 'buildAccessibilityTools',
  'Launch my refugee support': 'launchMyRefugeeSupport',
  'Create immigrant services': 'createImmigrantServices',
  'Fund my justice reform': 'fundMyJusticeReform',
  'Build rehabilitation programs': 'buildRehabilitationPrograms',
  'Launch my reentry services': 'launchMyReentryServices',
  'Create community healing': 'createCommunityHealing',
  // Infrastructure
  'Fund my cloud startup': 'fundMyCloudStartup',
  'Build developer tools': 'buildDeveloperTools',
  'Launch my DevOps platform': 'launchMyDevOpsPlatform',
  'Create monitoring solutions': 'createMonitoringSolutions',
  'Fund my security startup': 'fundMySecurityStartup',
  'Build authentication': 'buildAuthentication',
  'Launch my identity platform': 'launchMyIdentityPlatform',
  'Create access management': 'createAccessManagement',
  'Fund my networking startup': 'fundMyNetworkingStartup',
  'Build edge computing': 'buildEdgeComputing',
  'Launch my CDN': 'launchMyCDN',
  'Create serverless platform': 'createServerlessPlatform',
  'Fund my container platform': 'fundMyContainerPlatform',
  'Build orchestration tools': 'buildOrchestrationTools',
  'Launch my observability': 'launchMyObservability',
  'Create logging platform': 'createLoggingPlatform',
  'Fund my database startup': 'fundMyDatabaseStartup',
  'Build data pipelines': 'buildDataPipelines',
  'Launch my analytics platform': 'launchMyAnalyticsPlatform',
  'Create BI tools': 'createBITools',
  // Marketplaces
  'Fund my two-sided marketplace': 'fundMyTwoSidedMarketplace',
  'Build a services marketplace': 'buildAServicesMarketplace',
  'Launch my talent platform': 'launchMyTalentPlatform',
  'Create a freelancer marketplace': 'createAFreelancerMarketplace',
  'Fund my rental marketplace': 'fundMyRentalMarketplace',
  'Build peer-to-peer platform': 'buildPeerToPeerPlatform',
  'Launch my resale marketplace': 'launchMyResaleMarketplace',
  'Create a B2B marketplace': 'createAB2BMarketplace',
  'Fund my vertical marketplace': 'fundMyVerticalMarketplace',
  'Build a niche marketplace': 'buildANicheMarketplace',
  'Launch my local marketplace': 'launchMyLocalMarketplace',
  'Create a global marketplace': 'createAGlobalMarketplace',
  'Fund my commodity marketplace': 'fundMyCommodityMarketplace',
  'Build a digital goods marketplace': 'buildADigitalGoodsMarketplace',
  'Launch my subscription marketplace': 'launchMySubscriptionMarketplace',
  'Create a managed marketplace': 'createAManagedMarketplace',
  'Fund my reverse marketplace': 'fundMyReverseMarketplace',
  'Build an auction marketplace': 'buildAnAuctionMarketplace',
  'Launch my wholesale marketplace': 'launchMyWholesaleMarketplace',
  'Create a curated marketplace': 'createACuratedMarketplace',
  // Consumer Apps
  'Build a dating app': 'buildADatingApp',
  'Launch my messaging app': 'launchMyMessagingApp',
  'Create a photo app': 'createAPhotoApp',
  'Fund my video app': 'fundMyVideoApp',
  'Build a music app': 'buildAMusicApp',
  'Create a notes app': 'createANotesApp',
  'Fund my calendar app': 'fundMyCalendarApp',
  'Build a task manager': 'buildATaskManager',
  'Launch my habit tracker': 'launchMyHabitTracker',
  'Create a journal app': 'createAJournalApp',
  'Fund my language app': 'fundMyLanguageApp',
  'Build a learning app': 'buildALearningApp',
  'Launch my kids app': 'launchMyKidsApp',
  'Create a family app': 'createAFamilyApp',
  'Fund my travel app': 'fundMyTravelApp',
  'Build a maps alternative': 'buildAMapsAlternative',
  'Launch my food app': 'launchMyFoodApp',
  'Create a recipe app': 'createARecipeApp',
  // Enterprise
  'Fund my enterprise SaaS': 'fundMyEnterpriseSaaS',
  'Build sales tools': 'buildSalesTools',
  'Launch my CRM alternative': 'launchMyCRMAlternative',
  'Create marketing automation': 'createMarketingAutomation',
  'Fund my HR platform': 'fundMyHRPlatform',
  'Build recruiting tools': 'buildRecruitingTools',
  'Launch my onboarding platform': 'launchMyOnboardingPlatform',
  'Create employee engagement': 'createEmployeeEngagement',
  'Fund my collaboration tools': 'fundMyCollaborationTools',
  'Build project management': 'buildProjectManagement',
  'Launch my knowledge base': 'launchMyKnowledgeBase',
  'Create documentation tools': 'createDocumentationTools',
  'Fund my workflow automation': 'fundMyWorkflowAutomation',
  'Build no-code platform': 'buildNoCodePlatform',
  'Launch my integration platform': 'launchMyIntegrationPlatform',
  'Create API management': 'createAPIManagement',
  'Fund my compliance tools': 'fundMyComplianceTools',
  'Build risk management': 'buildRiskManagement',
  'Launch my procurement platform': 'launchMyProcurementPlatform',
  'Create vendor management': 'createVendorManagement',
  // Media & Entertainment
  'Fund my streaming service': 'fundMyStreamingService',
  'Build a music platform': 'buildAMusicPlatform',
  'Launch my podcast network': 'launchMyPodcastNetwork',
  'Create a video platform': 'createAVideoPlatform',
  'Fund my live events': 'fundMyLiveEvents',
  'Build virtual concerts': 'buildVirtualConcerts',
  'Launch my sports platform': 'launchMySportsPlatform',
  'Create a betting platform': 'createABettingPlatform',
  'Fund my news platform': 'fundMyNewsPlatform',
  'Build a journalism startup': 'buildAJournalismStartup',
  'Launch my content network': 'launchMyContentNetwork',
  'Create a studio': 'createAStudio',
  'Fund my production company': 'fundMyProductionCompany',
  'Build a talent agency': 'buildATalentAgency',
  'Launch my rights management': 'launchMyRightsManagement',
  'Create royalty distribution': 'createRoyaltyDistribution',
  'Fund my licensing platform': 'fundMyLicensingPlatform',
  'Build syndication network': 'buildSyndicationNetwork',
  'Launch my advertising platform': 'launchMyAdvertisingPlatform',
  'Create brand partnerships': 'createBrandPartnerships',
  // Real World Assets
  'Fund my real estate project': 'fundMyRealEstateProject',
  'Build property technology': 'buildPropertyTechnology',
  'Launch my tokenized assets': 'launchMyTokenizedAssets',
  'Create fractional ownership': 'createFractionalOwnership',
  'Fund my art investment': 'fundMyArtInvestment',
  'Build collectibles platform': 'buildCollectiblesPlatform',
  'Launch my wine fund': 'launchMyWineFund',
  'Create luxury goods market': 'createLuxuryGoodsMarket',
  'Fund my car investment': 'fundMyCarInvestment',
  'Build equipment leasing': 'buildEquipmentLeasing',
  'Launch my infrastructure fund': 'launchMyInfrastructureFund',
  'Create renewable energy tokens': 'createRenewableEnergyTokens',
  'Fund my commodity trading': 'fundMyCommodityTrading',
  'Build precious metals platform': 'buildPreciousMetalsPlatform',
  'Launch my carbon credits': 'launchMyCarbonCredits',
  'Create ESG investing': 'createESGInvesting',
  'Fund my farmland project': 'fundMyFarmlandProject',
  'Build agriculture investment': 'buildAgricultureInvestment',
  'Launch my timber fund': 'launchMyTimberFund',
  'Create natural resources fund': 'createNaturalResourcesFund',
  // Community Building
  'Build a private network': 'buildAPrivateNetwork',
  'Create an alumni network': 'createAnAlumniNetwork',
  'Fund my professional community': 'fundMyProfessionalCommunity',
  'Build an interest-based community': 'buildAnInterestBasedCommunity',
  'Launch my fan community': 'launchMyFanCommunity',
  'Create a creator community': 'createACreatorCommunity',
  'Fund my location-based community': 'fundMyLocationBasedCommunity',
  'Build a neighborhood app': 'buildANeighborhoodApp',
  'Launch my hobby community': 'launchMyHobbyCommunity',
  'Create a support group': 'createASupportGroup',
  'Fund my accountability community': 'fundMyAccountabilityCommunity',
  'Build a mastermind group': 'buildAMastermindGroup',
  'Launch my peer group': 'launchMyPeerGroup',
  'Create a cohort community': 'createACohortCommunity',
  'Fund my network state': 'fundMyNetworkState',
  'Build a digital nation': 'buildADigitalNation',
  'Launch my virtual city': 'launchMyVirtualCity',
  'Create a coordinated community': 'createACoordinatedCommunity',
  // Science & Research
  'Fund my scientific research': 'fundMyScientificResearch',
  'Build research infrastructure': 'buildResearchInfrastructure',
  'Launch my citizen science': 'launchMyCitizenScience',
  'Create open research': 'createOpenResearch',
  'Fund my academic project': 'fundMyAcademicProject',
  'Build research collaboration': 'buildResearchCollaboration',
  'Launch my lab equipment': 'launchMyLabEquipment',
  'Create research datasets': 'createResearchDatasets',
  'Fund my clinical research': 'fundMyClinicalResearch',
  'Build biomedical research': 'buildBiomedicalResearch',
  'Launch my physics project': 'launchMyPhysicsProject',
  'Create chemistry research': 'createChemistryResearch',
  'Fund my space research': 'fundMySpaceResearch',
  'Build astronomy project': 'buildAstronomyProject',
  'Launch my oceanography': 'launchMyOceanography',
  'Create geology research': 'createGeologyResearch',
  'Fund my archaeology': 'fundMyArchaeology',
  'Build paleontology project': 'buildPaleontologyProject',
  'Launch my anthropology': 'launchMyAnthropology',
  'Create linguistics research': 'createLinguisticsResearch',
  'Sequence an unknown genome': 'sequenceAnUnknownGenome',
  'Map the ocean floor': 'mapTheOceanFloor',
  'Discover a new species': 'discoverANewSpecies',
  'Fund my telescope time': 'fundMyTelescopeTime',
  'Build a particle detector': 'buildAParticleDetector',
  'Study dark matter': 'studyDarkMatter',
  'Research quantum computing': 'researchQuantumComputing',
  'Fund my fusion research': 'fundMyFusionResearch',
  'Decode ancient DNA': 'decodeAncientDNA',
  'Model climate systems': 'modelClimateSystems',
  // Arts & Culture
  'Fund my museum': 'fundMyMuseum',
  'Build a cultural center': 'buildACulturalCenter',
  'Launch my arts festival': 'launchMyArtsFestival',
  'Create a residency program': 'createAResidencyProgram',
  'Fund my public art': 'fundMyPublicArt',
  'Build a sculpture garden': 'buildASculptureGarden',
  'Launch my performance venue': 'launchMyPerformanceVenue',
  'Create a dance company': 'createADanceCompany',
  'Fund my orchestra': 'fundMyOrchestra',
  'Build a choir program': 'buildAChoirProgram',
  'Launch my opera company': 'launchMyOperaCompany',
  'Create a theater company': 'createATheaterCompany',
  'Fund my comedy venue': 'fundMyComedyVenue',
  'Build an improv theater': 'buildAnImprovTheater',
  'Launch my circus': 'launchMyCircus',
  'Create a magic show': 'createAMagicShow',
  'Fund my cultural preservation': 'fundMyCulturalPreservation',
  'Build heritage sites': 'buildHeritageSites',
  'Launch my historical society': 'launchMyHistoricalSociety',
  'Create archival project': 'createArchivalProject',
  // Sports & Fitness
  'Build a sports league': 'buildASportsLeague',
  'Launch my fitness brand': 'launchMyFitnessBrand',
  'Create a gym chain': 'createAGymChain',
  'Fund my athletic training': 'fundMyAthleticTraining',
  'Build sports technology': 'buildSportsTechnology',
  'Launch my fantasy sports': 'launchMyFantasySports',
  'Create sports analytics': 'createSportsAnalytics',
  'Fund my sports media': 'fundMySportsMedia',
  'Build a sports network': 'buildASportsNetwork',
  'Launch my athlete fund': 'launchMyAthleteFund',
  'Create sports scholarships': 'createSportsScholarships',
  'Fund my sports facility': 'fundMySportsFacility',
  'Build sports infrastructure': 'buildSportsInfrastructure',
  'Launch my adventure sports': 'launchMyAdventureSports',
  'Create outdoor recreation': 'createOutdoorRecreation',
  'Fund my extreme sports': 'fundMyExtremeSports',
  'Build action sports media': 'buildActionSportsMedia',
  'Launch my fitness app': 'launchMyFitnessApp',
  'Create workout content': 'createWorkoutContent',
  // Food & Beverage
  'Build a restaurant chain': 'buildARestaurantChain',
  'Launch my ghost kitchen': 'launchMyGhostKitchen',
  'Create a meal delivery': 'createAMealDelivery',
  'Fund my food brand': 'fundMyFoodBrand',
  'Build a CPG company': 'buildACPGCompany',
  'Launch my beverage brand': 'launchMyBeverageBrand',
  'Create a brewery': 'createABrewery',
  'Fund my distillery': 'fundMyDistillery',
  'Build a winery': 'buildAWinery',
  'Create a tea company': 'createATeaCompany',
  'Fund my bakery': 'fundMyBakery',
  'Build a chocolate company': 'buildAChocolateCompany',
  'Launch my ice cream brand': 'launchMyIceCreamBrand',
  'Create a snack company': 'createASnackCompany',
  'Fund my sauce company': 'fundMySauceCompany',
  'Build a condiment brand': 'buildACondimentBrand',
  'Launch my specialty food': 'launchMySpecialtyFood',
  'Create a farmers market': 'createAFarmersMarket',
  // Fashion & Beauty
  'Build a clothing line': 'buildAClothingLine',
  'Create a luxury brand': 'createALuxuryBrand',
  'Fund my sustainable fashion': 'fundMySustainableFashion',
  'Build an accessories brand': 'buildAnAccessoriesBrand',
  'Launch my jewelry line': 'launchMyJewelryLine',
  'Create a watch brand': 'createAWatchBrand',
  'Fund my beauty brand': 'fundMyBeautyBrand',
  'Build a skincare line': 'buildASkincareLine',
  'Launch my makeup brand': 'launchMyMakeupBrand',
  'Create a haircare line': 'createAHaircareLine',
  'Fund my fragrance brand': 'fundMyFragranceBrand',
  'Build a wellness brand': 'buildAWellnessBrand',
  'Launch my athleisure': 'launchMyAthleisure',
  'Create a footwear brand': 'createAFootwearBrand',
  'Fund my eyewear brand': 'fundMyEyewearBrand',
  'Build a bag brand': 'buildABagBrand',
  'Launch my fashion tech': 'launchMyFashionTech',
  'Create a virtual fashion': 'createAVirtualFashion',
  // Hardware & IoT
  'Build consumer electronics': 'buildConsumerElectronics',
  'Launch my smart home': 'launchMySmartHome',
  'Create IoT devices': 'createIoTDevices',
  'Fund my wearable tech': 'fundMyWearableTech',
  'Launch my robotics company': 'launchMyRoboticsCompany',
  'Create automation tools': 'createAutomationTools',
  'Fund my drone company': 'fundMyDroneCompany',
  'Build autonomous vehicles': 'buildAutonomousVehicles',
  'Launch my mobility startup': 'launchMyMobilityStartup',
  'Create e-bikes': 'createEBikes',
  'Fund my scooter company': 'fundMyScooterCompany',
  'Build electric vehicles': 'buildElectricVehicles',
  'Launch my charging network': 'launchMyChargingNetwork',
  'Create battery technology': 'createBatteryTechnology',
  'Fund my solar company': 'fundMySolarCompany',
  'Build energy storage': 'buildEnergyStorage',
  'Launch my semiconductor': 'launchMySemiconductor',
  'Create chip design': 'createChipDesign',
  // Identity traits (vibe chips)
  'making things': 'makingThings',
  'expressing myself': 'expressingMyself',
  'bringing people together': 'bringingPeopleTogether',
  'looking to support': 'lookingToSupport',
  'thinking big': 'thinkingBig',
  'writing code': 'writingCode',
  "fixing what's broken": 'fixingWhatsBroken',
  'starting a business': 'startingABusiness',
  'playing games': 'playingGames',
  'learning & teaching': 'learningAndTeaching',
  'helping my neighborhood': 'helpingMyNeighborhood',
  'just exploring': 'justExploring',
  'dreaming impossible things': 'dreamingImpossibleThings',
  'fighting the system': 'fightingTheSystem',
  'being a degen': 'beingADegen',
  'avoiding people': 'avoidingPeople',
  'causing chaos': 'causingChaos',
  'being normal': 'beingNormal',
  'getting rich': 'gettingRich',
  'giving back': 'givingBack',
  'doing less work': 'doingLessWork',
  'getting famous': 'gettingFamous',
  'staying anonymous': 'stayingAnonymous',
  'touching grass': 'touchingGrass',
  'saving the planet': 'savingThePlanet',
  'improving health': 'improvingHealth',
  'creating things': 'creatingThings',
  'making food': 'makingFood',
  'doing science': 'doingScience',
  'building AI': 'buildingAI',
  'going onchain': 'goingOnchain',
}

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
  'Nonprofit for coral reefs',
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
  'Sequence an unknown genome',
  'Map the ocean floor',
  'Discover a new species',
  'Fund my telescope time',
  'Build a particle detector',
  'Study dark matter',
  'Research quantum computing',
  'Fund my fusion research',
  'Decode ancient DNA',
  'Model climate systems',

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

// Pre-computed chip data for performance
interface ChipData {
  text: string
  displayText: string
  isCategory: boolean
  badgeType: 'id' | 'bold' | 'popular' | 'pro' | 'demo' | 'fun' | null
}

// Memoized chip component to avoid re-renders during scroll
const ChipButton = memo(function ChipButton({
  chip,
  theme,
  onClick,
  t,
}: {
  chip: ChipData
  theme: 'dark' | 'light'
  onClick: () => void
  t: (key: string, fallback: string) => string
}) {
  const { displayText, isCategory, badgeType } = chip
  const isDark = theme === 'dark'

  const className = isCategory
    ? isDark
      ? 'bg-yellow-500/20 border-yellow-400/50 text-yellow-300 font-medium hover:bg-yellow-500/35 hover:border-yellow-400'
      : 'bg-yellow-50 border-yellow-500/50 text-yellow-700 font-medium hover:bg-yellow-100 hover:border-yellow-500'
    : badgeType === 'bold'
      ? isDark
        ? 'bg-purple-500/25 border-purple-400/50 text-purple-300 hover:bg-purple-500/40 hover:border-purple-400'
        : 'bg-purple-50 border-purple-400/50 text-purple-700 hover:bg-purple-100 hover:border-purple-500'
      : badgeType === 'popular'
        ? isDark
          ? 'bg-juice-cyan/20 border-juice-cyan/40 text-juice-cyan hover:bg-juice-cyan/35 hover:border-juice-cyan'
          : 'bg-juice-cyan/10 border-juice-cyan/50 text-teal-700 hover:bg-juice-cyan/20 hover:border-teal-500'
        : badgeType === 'pro'
          ? isDark
            ? 'bg-juice-orange/20 border-juice-orange/40 text-juice-orange hover:bg-juice-orange/35 hover:border-juice-orange'
            : 'bg-orange-50 border-juice-orange/50 text-orange-700 hover:bg-orange-100 hover:border-orange-500'
          : badgeType === 'demo'
            ? isDark
              ? 'bg-pink-500/20 border-pink-400/40 text-pink-300 hover:bg-pink-500/35 hover:border-pink-400'
              : 'bg-pink-50 border-pink-400/50 text-pink-700 hover:bg-pink-100 hover:border-pink-500'
            : badgeType === 'fun'
              ? isDark
                ? 'bg-green-500/20 border-green-400/40 text-green-300 hover:bg-green-500/35 hover:border-green-400'
                : 'bg-green-50 border-green-400/50 text-green-700 hover:bg-green-100 hover:border-green-500'
              : isDark
                ? 'bg-gray-700/40 border-white/10 text-gray-300 hover:bg-gray-600/50 hover:border-white/25 hover:text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900'

  return (
    <button
      onMouseUp={onClick}
      onTouchEnd={onClick}
      className={`px-3 py-2 border text-sm whitespace-nowrap select-none flex items-center gap-2 transition-[background-color,border-color,color] duration-100 ${className}`}
      style={{ height: CHIP_HEIGHT }}
    >
      {displayText}
      {badgeType === 'id' && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-yellow-400">
          {t('badges.id', 'id')}
        </span>
      )}
      {badgeType === 'bold' && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-purple-400">
          {t('badges.bold', 'bold')}
        </span>
      )}
      {badgeType === 'popular' && (
        <span className="text-[10px] uppercase tracking-wide text-juice-cyan/70">
          {t('badges.popular', 'popular')}
        </span>
      )}
      {badgeType === 'pro' && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-yellow-400">
          {t('badges.pro', 'pro')}
        </span>
      )}
      {badgeType === 'demo' && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-pink-400">
          {t('badges.demo', 'demo')}
        </span>
      )}
      {badgeType === 'fun' && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-green-400">
          {t('badges.fun', 'fun')}
        </span>
      )}
    </button>
  )
})

export default function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const offsetRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const transformRef = useRef<HTMLDivElement>(null) // Direct DOM manipulation for smooth scrolling
  const rafIdRef = useRef<number | null>(null) // For requestAnimationFrame cleanup
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const hasDraggedRef = useRef(false)
  const lastPinchDistRef = useRef<number | null>(null)
  const [selectedTraits, setSelectedTraits] = useState<Set<TraitId>>(new Set())

  // Direct DOM update for transform (bypasses React re-render)
  const updateTransform = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px) scale(${scaleRef.current})`
    }
  }, [])

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

  // Pre-compute chip data for all suggestions (avoids recalculation during scroll)
  const chipDataMap = useMemo(() => {
    const map = new Map<string, ChipData>()
    const traitLabels = traits.map(tr => tr.label)

    filteredSuggestions.forEach(suggestion => {
      const isCategory = traitLabels.includes(suggestion)
      const displayText = suggestionKeyMap[suggestion]
        ? t(`suggestions.${suggestionKeyMap[suggestion]}`, suggestion)
        : suggestion

      let badgeType: ChipData['badgeType'] = null
      if (isCategory) {
        badgeType = 'id'
      } else if (boldSuggestions.has(suggestion)) {
        badgeType = 'bold'
      } else if (popularSuggestions.has(suggestion)) {
        badgeType = 'popular'
      } else if (proSuggestions.has(suggestion)) {
        badgeType = 'pro'
      } else if (demoSuggestions.has(suggestion)) {
        badgeType = 'demo'
      } else if (funSuggestions.has(suggestion)) {
        badgeType = 'fun'
      }

      map.set(suggestion, {
        text: suggestion,
        displayText,
        isCategory,
        badgeType,
      })
    })
    return map
  }, [filteredSuggestions, t])

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

  // Sync state periodically during continuous scrolling (for visibility calculations)
  const syncStateRef = useRef<number | null>(null)
  const scheduleSyncState = useCallback(() => {
    if (syncStateRef.current) return // Already scheduled
    syncStateRef.current = requestAnimationFrame(() => {
      syncStateRef.current = null
      setOffset({ ...offsetRef.current })
    })
  }, [])

  // Use refs + document-level listeners for reliable dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      offsetRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      }
      // Direct DOM update for smooth scrolling (no React re-render)
      updateTransform()
      // Schedule state sync for visibility calculations
      scheduleSyncState()
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      // Final state sync when drag ends
      setOffset({ ...offsetRef.current })
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
          updateTransform()
          setScale(newScale)
        }
        lastPinchDistRef.current = dist
        return
      }

      // Single finger drag
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      const touch = e.touches[0]
      offsetRef.current = {
        x: touch.clientX - dragStartRef.current.x,
        y: touch.clientY - dragStartRef.current.y,
      }
      // Direct DOM update for smooth scrolling (no React re-render)
      updateTransform()
      // Schedule state sync for visibility calculations
      scheduleSyncState()
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
      lastPinchDistRef.current = null
      // Final state sync when touch ends
      setOffset({ ...offsetRef.current })
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
        updateTransform()
        setScale(newScale)
        return
      }

      // Regular scroll = pan - use RAF for batched updates
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }

      offsetRef.current = {
        x: offsetRef.current.x - e.deltaX,
        y: offsetRef.current.y - e.deltaY,
      }
      // Direct DOM update for smooth scrolling (no React re-render)
      updateTransform()

      // Debounce state sync to reduce re-renders during fast scrolling
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        setOffset({ ...offsetRef.current })
      })
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
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      if (syncStateRef.current) cancelAnimationFrame(syncStateRef.current)
    }
  }, [updateTransform, scheduleSyncState])

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
    updateTransform()
    setOffset(newOffset)
  }

  const handleResetZoom = () => {
    scaleRef.current = 1
    updateTransform()
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

  return (
    <div className="flex-1 relative h-full overflow-hidden">
      {/* Shuffle & Zoom controls - top right of visible chip area (left of mascot on large screens) */}
      <div className="absolute top-2 right-4 lg:right-[calc(27.53%+1rem)] z-10 flex items-center gap-2">
        {scale !== 1 && (
          <button
            onClick={handleResetZoom}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/70 backdrop-blur-sm'
                : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/70 backdrop-blur-sm'
            }`}
          >
            {Math.round(scale * 100)}%
          </button>
        )}
        <button
          onClick={handleShuffle}
          className={`px-3 py-1.5 text-sm border transition-colors ${
            theme === 'dark'
              ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/70 backdrop-blur-sm'
              : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/70 backdrop-blur-sm'
          }`}
        >
          {t('ui.shuffle', 'Shuffle')}
        </button>
      </div>

      {/* Selected categories - top left */}
      {selectedTraits.size > 0 && (
        <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
            {Array.from(selectedTraits).map(traitId => {
              const trait = traits.find(t => t.id === traitId)
              if (!trait) return null
              const traitKey = suggestionKeyMap[trait.label]
              const translatedLabel = traitKey ? t(`suggestions.${traitKey}`, trait.label) : trait.label
              return (
                <button
                  key={traitId}
                  onClick={() => toggleTrait(traitId)}
                  className={`px-3 py-2 text-sm border flex items-center gap-2 transition-colors ${
                    theme === 'dark'
                      ? 'bg-juice-dark/70 backdrop-blur-sm border-juice-orange text-juice-orange hover:bg-juice-dark'
                      : 'bg-white/70 backdrop-blur-sm border-juice-orange text-orange-700 hover:bg-white'
                  }`}
                >
                  {translatedLabel}
                  <span className="text-xs opacity-60">×</span>
                </button>
              )
            })}
            <span className={`text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {filteredSuggestions.length} {t('ui.matches', 'matches')}
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
          ref={transformRef}
          className="absolute inset-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            willChange: 'transform', // GPU acceleration for smooth scrolling
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
                          const chipData = chipDataMap.get(suggestion)
                          if (!chipData) return null

                          return (
                            <ChipButton
                              key={`${tileX}_${chipIdx}`}
                              chip={chipData}
                              theme={theme}
                              onClick={() => handleChipClick(chipData.displayText)}
                              t={t}
                            />
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

    </div>
  )
}
