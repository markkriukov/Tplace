import FallbackImage from '../../../shared/ui/FallbackImage.jsx'
import LoadingSkeleton from '../../../shared/ui/LoadingSkeleton.jsx'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import NewsForm from '../components/NewsForm.jsx'

function NewsPage({ news, editor, isAdmin = false }) {
  const { t } = useTranslation()
  const {
    newsItems, hasLoadedNews, isLoading, loadError, loadNews,
    isMutating, isCreatingNews, updatingNewsId, deletingNewsId,
  } = news
  const {
    isCreateOpen, toggleCreate, createForm, setCreateField, createError, submitCreate,
    editingNewsId, editForm, setEditField, editError, openEdit, closeEdit, submitEdit,
    deleteError, removeNews,
  } = editor

  return (
    <main className="news-page" aria-label={t('news.latest')}>
      <h2 className="news-page-title">{t('news.latest')}</h2>
      {isAdmin && (
        <section className="news-admin-block" aria-label={t('news.createSection')}>
          <button type="button" className="news-create-toggle" disabled={isMutating} onClick={toggleCreate}>
            {isCreateOpen ? t('news.closeForm') : t('news.create')}
          </button>
          {isCreateOpen && (
            <NewsForm
              className="news-create-form"
              form={createForm}
              onFieldChange={setCreateField}
              onSubmit={submitCreate}
              disabled={isMutating}
              error={createError}
              submitContent={isCreatingNews ? <LoadingSkeleton variant="inline" label={t('common.creating')} /> : t('common.create')}
            />
          )}
        </section>
      )}
      {deleteError && <p className="news-create-error">{t(deleteError)}</p>}
      <div className="news-list" aria-busy={isLoading}>
        {isLoading && !hasLoadedNews && (
          <LoadingSkeleton variant="news" className="news-loading" label={t('news.loading')} />
        )}
        {loadError && (
          <div className="news-load-error" role="alert">
            <p>{t('news.loadFailed')}</p>
            <button type="button" className="news-admin-btn" onClick={() => loadNews()}>{t('common.retry')}</button>
          </div>
        )}
        {(!isLoading || hasLoadedNews) && !loadError && newsItems.length === 0 && (
          <p className="news-empty">{t('news.empty')}</p>
        )}
        {newsItems.map((item) => {
          const isEditingThis = editingNewsId === item.id
          return (
            <article className="news-card news-card-reveal" key={`news-${item.id}`}>
              <div className="news-card-grid">
                <div className="news-card-copy">
                  <h3 className="news-card-title">{item.title}</h3>
                  <p className="news-card-lead">{item.lead}</p>
                  <p className="news-card-text">{item.text}</p>
                  <p className="news-card-date">{item.date}</p>
                </div>
                <FallbackImage src={item.image} fallbackSrc="/tplace-icon.svg" alt={item.title} className="news-card-image" />
              </div>

              {isAdmin && (
                <div className="news-card-admin-actions">
                  <button
                    type="button"
                    className="news-admin-btn"
                    onClick={() => (isEditingThis ? closeEdit() : openEdit(item))}
                    disabled={isMutating}
                  >
                    {isEditingThis ? t('common.cancel') : t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="news-admin-btn news-admin-btn-danger"
                    onClick={() => removeNews(item.id)}
                    disabled={isMutating}
                  >
                    {deletingNewsId === item.id ? <LoadingSkeleton variant="inline" label={t('common.deleting')} /> : t('common.delete')}
                  </button>
                </div>
              )}

              {isAdmin && isEditingThis && (
                <NewsForm
                  className="news-edit-form"
                  form={editForm}
                  onFieldChange={setEditField}
                  onSubmit={submitEdit}
                  disabled={isMutating}
                  error={editError}
                  submitContent={updatingNewsId === item.id ? <LoadingSkeleton variant="inline" label={t('common.saving')} /> : t('common.save')}
                />
              )}
            </article>
          )
        })}
      </div>
    </main>
  )
}

export default NewsPage
