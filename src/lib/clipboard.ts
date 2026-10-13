export async function copyText(value: string) {
  if (!value) throw new Error('没有可复制的内容')

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // HTTP 页面和部分内嵌浏览器会拒绝 Clipboard API，继续使用兼容方案。
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.className = 'clipboard-copy-source'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制操作')
  } finally {
    textarea.remove()
  }
}
