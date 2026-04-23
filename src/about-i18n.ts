export type AboutLang = 'es' | 'en'

const pratyushContent = {
  slug: 'about',
  altSlug: 'about',
  seo: {
    title: 'Pratyush Kumar | Senior Leader · AI & Digital Transformation',
    description: 'Senior corporate leader and entrepreneur with 25+ years of global experience across Banking, Financial Services, IT, Digital Transformation, and AI. Director at Prabisha Consulting. Ex-S&P Global, Ex-HSBC, Ex-Northern Trust.',
  },
  heading: 'Pratyush Kumar',
  subtitle: 'Director, Prabisha Consulting · AI & Digital Transformation · Six Sigma Black Belt',
  location: 'London, United Kingdom',
  lastUpdated: 'April 2026',
  bio: [
    'Senior corporate leader and entrepreneur with 25+ years of global experience across Banking, Financial Services, IT and Digital Transformation, Operational Excellence, Digital Marketing, HR Transformation, and Consulting.',
    'Proven track record of building, scaling, and transforming businesses through AI-enabled solutions, leading large cross-functional teams, and delivering enterprise-wide change across UK, Europe, Americas, APAC, and EMEA.',
    'Currently building AI Nexus World — combining deep corporate experience with hands-on AI and digital expertise. Six Sigma Black Belt with coaching-led leadership style and board-level stakeholder engagement.',
  ],
  seeking: 'Open to senior leadership and consulting opportunities globally',
  roles: ['Director, Prabisha Consulting', 'AI & Digital Transformation Leader', 'Six Sigma Black Belt'],
  timelineHeading: 'Experience',
  timeline: [
    { period: '2022–Present', role: 'Director', company: 'Prabisha Consulting Limited (UK)', desc: 'AI, Software, Digital Marketing, Shopify, Chatbots, E-Commerce, Lead Gen, SEO, GCC, Cost Optimisation' },
    { period: '2018–2022', role: 'Director', company: 'Prabisha Consulting Pvt. Ltd.', desc: 'Global sales, marketing, operations across Asia, Europe, USA and UAE' },
    { period: '2015–2018', role: 'Director', company: 'S&P Global', desc: 'Enterprise-wide transformation across Operations and Technology' },
    { period: '2013–2014', role: 'Assistant Vice President', company: 'HSBC', desc: 'Relationship lead for Europe and Brazil, strategic finance migrations' },
    { period: '2006–2012', role: 'Second Vice President', company: 'Northern Trust', desc: "200+ global process migrations, 3,000+ FTEs, Chairman's Award recipient" },
    { period: '2005–2007', role: 'Associate Manager – Transition & PMO', company: 'HCLTech', desc: 'Investment Banking and Capital Markets operations for Deutsche Bank' },
  ],
  projectsHeading: 'Key Initiatives',
  projects: [
    { name: 'AI Nexus World', desc: 'Building AI-enabled solutions for businesses — Chatbots, Custom Software, Digital Marketing', href: '/about' },
    { name: 'Prabisha Consulting', desc: 'Digital transformation, AI, SEO, E-commerce, Lead Generation for global clients', href: '/about' },
    { name: 'S&P Global Transformation', desc: 'Enterprise BPM with IBM Blueworks Live, WorkFusion automation, 60+ process metrics', href: '/about' },
    { name: 'Northern Trust Migrations', desc: '200+ global process migrations covering 3,000+ roles across UK, Europe, APAC, US', href: '/about' },
  ],
  certificationsHeading: 'Certifications & Education',
  certifications: [
    { org: 'Indian Statistical Institute (SQC & OR)', items: ['Six Sigma Black Belt in Quality Management'] },
    { org: 'Indian Institute of Mass Communication, Delhi', items: ['PGDM, Marketing (2000–2001)'] },
    { org: 'Jawaharlal Nehru University', items: ["Bachelor's Degree (1997–2000)"] },
  ],
  educationHeading: 'Education',
  education: [
    'Indian Statistical Institute — Six Sigma Black Belt in Quality Management',
    'Indian Institute of Mass Communication, Delhi — PGDM, Marketing',
    'Jawaharlal Nehru University — Bachelor\'s Degree',
  ],
  pressHeading: 'Press',
  press: [] as { title: string; publisher: string; date: string; href: string }[],
  communityHeading: 'Community',
  community: [] as { title: string; platform: string; href: string }[],
  faqHeading: 'Frequently Asked Questions',
  faq: [
    { q: 'Who is Pratyush Kumar?', a: 'Pratyush Kumar is a senior corporate leader and entrepreneur with 25+ years of global experience across Banking, Financial Services, IT and Digital Transformation. He is Director at Prabisha Consulting Limited (UK) and is building AI Nexus World. Previously held senior roles at S&P Global, HSBC, Northern Trust, and HCLTech. Six Sigma Black Belt certified. Based in London, United Kingdom.' },
    { q: 'What does Pratyush Kumar do?', a: 'Pratyush Kumar builds and transforms businesses through AI-enabled solutions. At Prabisha Consulting, he delivers AI, Software, Website & Digital Marketing, Shopify, Custom Software, Chatbots, E-Commerce, Lead Generation, SEO, GCC, and Cost Optimisation services. He has 18K+ followers on LinkedIn.' },
    { q: "What is Pratyush Kumar's background?", a: 'Pratyush Kumar has 25+ years of global experience. He led enterprise-wide transformation at S&P Global, managed strategic finance migrations at HSBC, executed 200+ global process migrations at Northern Trust (recipient of Chairman\'s Signature Service Quality Medallion Award), and delivered Investment Banking PMO at HCLTech.' },
  ],
  connectHeading: 'Connect',
  email: 'pratyush@prabisha.com',
}

export const aboutContent = {
  es: pratyushContent,
  en: pratyushContent,
} as const
