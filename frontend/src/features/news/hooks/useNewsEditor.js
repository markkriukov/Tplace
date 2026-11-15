import { useState } from 'react'

const emptyForm = { title: '', lead: '', content: '', imageUrl: '' }
const toNewsPayload = (form) => ({
  title: form.title, lead: form.lead, content: form.content, image_url: form.imageUrl, is_published: true,
})

/** Drafts of the create and edit forms; they live in App so they survive navigation. */
export function useNewsEditor(news) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [createError, setCreateError] = useState('')
  const [editingNewsId, setEditingNewsId] = useState(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editError, setEditError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const closeCreate = () => {
    setIsCreateOpen(false)
    setCreateForm(emptyForm)
    setCreateError('')
  }

  const toggleCreate = () => {
    if (news.isMutating) return
    if (isCreateOpen) return closeCreate()
    setIsCreateOpen(true)
    setCreateError('')
  }

  const submitCreate = async (event) => {
    event.preventDefault()
    if (news.isMutating) return
    setCreateError('')
    try {
      if (await news.createNewsItem(toNewsPayload(createForm))) closeCreate()
    } catch (error) {
      setCreateError(error.message || 'news.createFailed')
    }
  }

  const openEdit = (item) => {
    if (news.isMutating) return
    setEditingNewsId(item.id)
    setEditForm({ title: item.title, lead: item.lead, content: item.text, imageUrl: item.image_url })
    setEditError('')
    setDeleteError('')
  }

  const closeEdit = () => {
    setEditingNewsId(null)
    setEditForm(emptyForm)
    setEditError('')
  }

  const submitEdit = async (event) => {
    event.preventDefault()
    if (news.isMutating || !editingNewsId) return
    setEditError('')
    try {
      if (await news.updateNewsItem(editingNewsId, toNewsPayload(editForm))) closeEdit()
    } catch (error) {
      setEditError(error.message || 'news.updateFailed')
    }
  }

  const removeNews = async (newsId) => {
    if (news.isMutating) return
    setDeleteError('')
    try {
      await news.removeNewsItem(newsId)
    } catch (error) {
      setDeleteError(error.message || 'news.deleteFailed')
    }
  }

  return {
    isCreateOpen, toggleCreate, createForm, createError, submitCreate,
    setCreateField: (name, value) => setCreateForm((form) => ({ ...form, [name]: value })),
    editingNewsId, editForm, editError, openEdit, closeEdit, submitEdit,
    setEditField: (name, value) => setEditForm((form) => ({ ...form, [name]: value })),
    deleteError, removeNews,
  }
}
