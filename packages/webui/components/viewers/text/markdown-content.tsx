import React, { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/ui/lib/utils'
import { m } from '@/ui/paraglide/messages.js'

/**
 * Classes shared by every block that carries a `data-line` (its first source
 * line), so the viewer can scroll to and highlight the block a comment points at.
 */
export const LINE_BLOCK_CLASS =
  'scroll-mt-4 rounded-sm transition-colors data-[active=true]:bg-primary/10 data-[active=true]:ring-1 data-[active=true]:ring-primary/30'

type SourceNode = { position?: { start: { line: number } } } | undefined

function lineOf(node: SourceNode): number | undefined {
  return node?.position?.start.line
}

/** Returns the props without react-markdown's `node`, which must not reach the DOM. */
function stripNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const rest = { ...props }
  delete rest.node
  return rest
}

const components: Components = {
  h1: ({ node, className, ...props }) => (
    <h1
      data-line={lineOf(node)}
      className={cn(
        LINE_BLOCK_CLASS,
        'mt-6 mb-3 border-b border-border pb-1 text-2xl font-semibold',
        className,
      )}
      {...props}
    />
  ),
  h2: ({ node, className, ...props }) => (
    <h2
      data-line={lineOf(node)}
      className={cn(
        LINE_BLOCK_CLASS,
        'mt-6 mb-3 border-b border-border pb-1 text-xl font-semibold',
        className,
      )}
      {...props}
    />
  ),
  h3: ({ node, className, ...props }) => (
    <h3
      data-line={lineOf(node)}
      className={cn(LINE_BLOCK_CLASS, 'mt-5 mb-2 text-lg font-semibold', className)}
      {...props}
    />
  ),
  h4: ({ node, className, ...props }) => (
    <h4
      data-line={lineOf(node)}
      className={cn(LINE_BLOCK_CLASS, 'mt-4 mb-2 text-base font-semibold', className)}
      {...props}
    />
  ),
  h5: ({ node, className, ...props }) => (
    <h5
      data-line={lineOf(node)}
      className={cn(LINE_BLOCK_CLASS, 'mt-4 mb-2 text-sm font-semibold', className)}
      {...props}
    />
  ),
  h6: ({ node, className, ...props }) => (
    <h6
      data-line={lineOf(node)}
      className={cn(
        LINE_BLOCK_CLASS,
        'mt-4 mb-2 text-sm font-semibold text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
  p: ({ node, className, ...props }) => (
    <p
      data-line={lineOf(node)}
      className={cn(LINE_BLOCK_CLASS, 'my-3 leading-7', className)}
      {...props}
    />
  ),
  li: ({ node, className, ...props }) => (
    <li
      data-line={lineOf(node)}
      className={cn(LINE_BLOCK_CLASS, 'my-1 leading-7', className)}
      {...props}
    />
  ),
  blockquote: ({ node, className, ...props }) => (
    <blockquote
      data-line={lineOf(node)}
      className={cn(
        LINE_BLOCK_CLASS,
        'my-3 border-l-4 border-border pl-4 text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
  pre: ({ node, className, ...props }) => (
    <pre
      data-line={lineOf(node)}
      className={cn(
        LINE_BLOCK_CLASS,
        'my-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]',
        className,
      )}
      {...props}
    />
  ),
  tr: ({ node, className, ...props }) => (
    <tr data-line={lineOf(node)} className={cn(LINE_BLOCK_CLASS, className)} {...props} />
  ),
  hr: ({ node, className, ...props }) => (
    <hr data-line={lineOf(node)} className={cn('my-6 border-border', className)} {...props} />
  ),
  ul: (props) => {
    const { className, ...rest } = stripNode(props)
    return <ul className={cn('my-3 list-disc pl-6', className)} {...rest} />
  },
  ol: (props) => {
    const { className, ...rest } = stripNode(props)
    return <ol className={cn('my-3 list-decimal pl-6', className)} {...rest} />
  },
  table: (props) => {
    const { className, ...rest } = stripNode(props)
    return (
      <div className="my-3 overflow-x-auto">
        <table className={cn('w-full border-collapse text-sm', className)} {...rest} />
      </div>
    )
  },
  thead: (props) => {
    const { className, ...rest } = stripNode(props)
    return <thead className={cn('bg-muted', className)} {...rest} />
  },
  th: (props) => {
    const { className, ...rest } = stripNode(props)
    return (
      <th
        className={cn('border border-border px-3 py-1.5 text-left font-semibold', className)}
        {...rest}
      />
    )
  },
  td: (props) => {
    const { className, ...rest } = stripNode(props)
    return <td className={cn('border border-border px-3 py-1.5', className)} {...rest} />
  },
  code: (props) => {
    const { className, ...rest } = stripNode(props)
    return (
      <code
        className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]', className)}
        {...rest}
      />
    )
  },
  a: (props) => {
    const { className, ...rest } = stripNode(props)
    return (
      <a
        {...rest}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={cn('text-primary underline underline-offset-2', className)}
        onClick={(e) => e.stopPropagation()}
      />
    )
  },
  // Images are not loaded: relative paths cannot resolve and remote ones would
  // leak viewers' addresses to third parties (including on public share links).
  img: ({ alt }) => (
    <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
      {alt ? m.markdown_image_with_alt({ alt }) : m.markdown_image()}
    </span>
  ),
}

/** Renders Markdown with GFM; raw HTML is shown as text, never rendered. */
export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="text-sm text-foreground break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
})
