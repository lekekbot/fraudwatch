"use client"

import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { cn } from "cn"

/**
 * One choice from a few, as a row of buttons: a radio group, so arrow keys move
 * between options and Tab leaves the group.
 */
function Segmented<V extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: {
  value: V
  onValueChange: (value: V) => void
  options: readonly { value: V; label: string; title?: string }[]
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  disabled?: boolean
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      className={cn("inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5", className)}
      {...props}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            "data-checked:bg-background data-checked:text-foreground data-checked:shadow-xs data-checked:ring-1 data-checked:ring-border dark:data-checked:bg-input",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

export { Segmented }
