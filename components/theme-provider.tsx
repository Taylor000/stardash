"use client"
import { createContext, useContext, useEffect, type ReactNode } from "react"
type Theme = "light" | "dark" | "system"
const fixed = {
  theme: "light" as Theme,
  resolvedTheme: "light" as "light" | "dark",
  setTheme: (theme: Theme) => {
    void theme
  },
}
const ThemeContext = createContext(fixed)
export function ThemeProvider({
  children,
}: {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
  enableSystem?: boolean
  attribute?: "class"
}) {
  useEffect(() => {
    document.documentElement.classList.remove("dark")
    document.documentElement.classList.add("light")
    localStorage.setItem("stardash-theme", "light")
  }, [])
  return <ThemeContext.Provider value={fixed}>{children}</ThemeContext.Provider>
}
export function useTheme() {
  return useContext(ThemeContext)
}
