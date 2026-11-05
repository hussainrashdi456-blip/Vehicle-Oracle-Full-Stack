import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, BarChart3, Camera, GitCompare, History, Store, Tag, ShieldCheck } from 'lucide-react'
import { inView, slideUp, stagger } from '../../lib/motion'

const features = [
  { icon: Tag, title: 'Price Prediction', text: 'Instant AI valuation with an explanation of every factor.', to: '/predict' },
  { icon: Camera, title: 'Damage Detection', text: 'Upload a photo, get damage severity and a repair estimate.', to: '/damage' },
  { icon: GitCompare, title: 'Compare Cars', text: 'Put up to three cars side by side and find the best value.', to: '/compare' },
  { icon: BarChart3, title: 'Market Trends', text: 'Track inflation, policy rate and average prices over time.', to: '/trends' },
  { icon: Store, title: 'Marketplace', text: 'Browse verified listings and contact sellers on WhatsApp.', to: '/marketplace' },
  { icon: History, title: 'Your Dashboard', text: 'Every valuation saved, with price history charts.', to: '/history' },
]

export default function FeatureGrid() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-7xl px-5">
        <motion.div variants={stagger(0.1)} {...inView} className="mx-auto max-w-2xl text-center">
          <motion.p variants={slideUp(0, 16)} className="text-sm font-bold uppercase tracking-widest text-sky-500">Platform</motion.p>
          <motion.h2 variants={slideUp(0, 24)} className="mt-2 text-3xl font-extrabold tracking-tight text-slate-800 sm:text-4xl">
            Everything you need to buy or sell smarter
          </motion.h2>
        </motion.div>

        <motion.div variants={stagger(0.08)} {...inView} className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text, to }) => (
            <Link key={title} to={to}>
              <motion.div variants={slideUp(0, 30)} whileHover={{ y: -8 }}
                className="group h-full rounded-2xl border p-7 transition-shadow border-sky-100 bg-white hover:shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-500 transition-colors group-hover:bg-sky-500 group-hover:text-white">
                  <Icon size={24} />
                </div>
                <h3 className="mt-5 flex items-center gap-2 text-lg font-bold text-slate-800">
                  {title}
                </h3>
                <p className="mt-2 text-slate-500">{text}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-sky-600">
                  Try it now <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </span>
              </motion.div>
            </Link>
          ))}
        </motion.div>
      </div>
    </section>
  )
}