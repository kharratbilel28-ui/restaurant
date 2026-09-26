import { useEffect, useState } from 'react'
import { createPlatformRestaurant, createSubscriptionPlan, getPlatformOverview, updatePlatformRestaurant, updateRestaurantSubscription, type ManagedRestaurant, type PlatformOverview } from './api'
import './platform-owner.css'

function validRestaurantIdentifier(value: string) {
  const identifier = value.trim().toLowerCase()
  const slug = /^[a-z0-9][a-z0-9-]{2,39}$/
  const email = /^[a-z0-9.!#$%&'*+?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
  return identifier.length <= 254 && (slug.test(identifier) || email.test(identifier))
}

function validUsername(value: string) { return /^[a-z0-9._-]{3,32}$/.test(value.trim().toLowerCase()) }

export function PlatformOwnerDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [planName, setPlanName] = useState('')
  const [planDays, setPlanDays] = useState(30)
  const [planPrice, setPlanPrice] = useState('29')
  const [restaurantName, setRestaurantName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [restaurantPassword, setRestaurantPassword] = useState('')
  const [managerUsername, setManagerUsername] = useState('')
  const [managerName, setManagerName] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [rowPlans, setRowPlans] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<ManagedRestaurant | null>(null)
  const [editName, setEditName] = useState('')
  const [editIdentifier, setEditIdentifier] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [firstManagerUsername, setFirstManagerUsername] = useState('')
  const [firstManagerName, setFirstManagerName] = useState('')
  const [firstManagerPin, setFirstManagerPin] = useState('')
  const [editPlanId, setEditPlanId] = useState('')
  const [lastIssued, setLastIssued] = useState<{ identifier: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => setOverview(await getPlatformOverview())
  useEffect(() => { getPlatformOverview().then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')) }, [])
  const activePlans = overview?.plans.filter((plan) => plan.active) || []
  const createIssues = [
    !restaurantName.trim() && 'Indique le nom du restaurant.',
    !validRestaurantIdentifier(identifier) && 'Identifiant : saisis un slug de 3 à 40 caractères ou une adresse e-mail valide.',
    restaurantPassword.length < 8 && 'Le mot de passe restaurant doit contenir au moins 8 caractères.',
    !validUsername(managerUsername) && 'Le nom d’utilisateur du gérant doit contenir 3 à 32 caractères.',
    managerName.trim().length < 2 && 'Indique le nom affiché du gérant.',
    !/^\d{4,12}$/.test(managerPin) && 'Le PIN du gérant doit contenir de 4 à 12 chiffres.',
    !activePlans.length && 'Crée d’abord une offre active.',
  ].filter(Boolean) as string[]

  const createPlan = async () => {
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setLastIssued(null)
    try { await createSubscriptionPlan({ name: planName.trim(), durationDays: planDays, price: Number(planPrice) }); await refresh(); setPlanName(''); setNotice('Offre créée.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Création de l’offre impossible.') }
    finally { setBusy(false) }
  }

  const createRestaurant = async () => {
    if (busy || createIssues.length) return
    setBusy(true); setError(''); setNotice('')
    const account = { identifier: identifier.trim().toLowerCase(), password: restaurantPassword }
    try {
      await createPlatformRestaurant({ ...account, name: restaurantName.trim(), managerUsername: managerUsername.trim().toLowerCase(), managerName: managerName.trim(), managerPin, planId: selectedPlanId || activePlans[0].id })
      await refresh(); setLastIssued(account); setNotice('Restaurant créé. Conserve les identifiants affichés ci-dessous.')
      setRestaurantName(''); setIdentifier(''); setRestaurantPassword(''); setManagerUsername(''); setManagerName(''); setManagerPin('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Création du restaurant impossible.') }
    finally { setBusy(false) }
  }

  const openEdit = (restaurant: ManagedRestaurant) => {
    setEditing(restaurant); setEditName(restaurant.name); setEditIdentifier(restaurant.identifier); setEditPassword('')
    setFirstManagerUsername(''); setFirstManagerName(''); setFirstManagerPin(''); setEditPlanId(restaurant.planId || activePlans[0]?.id || '')
    setError(''); setNotice('')
  }

  const saveEdit = async () => {
    if (!editing || busy) return
    const setupIssues = editing.accessConfigured ? [] : [
      !validUsername(firstManagerUsername) && 'Nom d’utilisateur du gérant requis (3 à 32 caractères).',
      firstManagerName.trim().length < 2 && 'Nom affiché du gérant requis.',
      !/^\d{4,12}$/.test(firstManagerPin) && 'PIN gérant requis (4 à 12 chiffres).',
      editPassword.length < 8 && 'Mot de passe restaurant requis (8 caractères minimum).',
      !editPlanId && 'Choisis une offre active.',
    ].filter(Boolean) as string[]
    if (!validRestaurantIdentifier(editIdentifier) || editName.trim().length < 2 || (editPassword && editPassword.length < 8) || setupIssues.length) {
      setError(setupIssues[0] || 'Vérifie le nom et l’identifiant du restaurant. Un nouveau mot de passe doit contenir au moins 8 caractères.')
      return
    }
    setBusy(true); setError(''); setNotice(''); setLastIssued(null)
    try {
      if (editing.accessConfigured) {
        await updatePlatformRestaurant(editing.id, { identifier: editIdentifier.trim().toLowerCase(), name: editName.trim(), ...(editPassword ? { password: editPassword } : {}) })
        if (editPassword) setLastIssued({ identifier: editIdentifier.trim().toLowerCase(), password: editPassword })
        setNotice('Restaurant modifié. Le mot de passe existant n’est pas lisible; celui-ci a été réinitialisé si tu en as saisi un nouveau.')
      } else {
        await createPlatformRestaurant({ identifier: editIdentifier.trim().toLowerCase(), name: editName.trim(), password: editPassword, managerUsername: firstManagerUsername.trim().toLowerCase(), managerName: firstManagerName.trim(), managerPin: firstManagerPin, planId: editPlanId })
        setLastIssued({ identifier: editIdentifier.trim().toLowerCase(), password: editPassword })
        setNotice('Accès gérant configuré et licence attribuée. Conserve les identifiants affichés ci-dessous.')
      }
      await refresh(); setEditing(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Modification impossible.') }
    finally { setBusy(false) }
  }

  const assignPlan = async (restaurant: ManagedRestaurant, status: 'active' | 'suspended') => {
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setLastIssued(null)
    const planId = rowPlans[restaurant.id] || restaurant.planId || activePlans[0]?.id || ''
    try { await updateRestaurantSubscription(restaurant.id, { planId, status }); await refresh(); setNotice(status === 'active' ? `Licence de ${restaurant.name} renouvelée.` : `Accès de ${restaurant.name} suspendu.`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour de la licence impossible.') }
    finally { setBusy(false) }
  }

  const expiryLabel = (restaurant: ManagedRestaurant) => restaurant.status === 'suspended' ? 'Suspendu' : restaurant.expiresAt && new Date(restaurant.expiresAt).getTime() <= Date.now() ? 'Expiré' : restaurant.expiresAt ? 'Actif' : 'À configurer'

  return <div className="platform-shell">
    <header className="platform-header"><div><p className="eyebrow">SERVICEPILOT · PROPRIÉTAIRE</p><h1>Gestion des restaurants</h1></div><button className="action-button" onClick={onLogout}>Déconnexion</button></header>
    {error && <p className="login-error">{error}</p>}{notice && <p className="server-notice">{notice}</p>}
    {lastIssued && <section className="platform-issued-credentials"><strong>Identifiants à conserver</strong><span>Restaurant : <code>{lastIssued.identifier}</code></span><span>Mot de passe : <code>{lastIssued.password}</code></span><small>Il ne sera pas possible de relire ce mot de passe après avoir quitté cette page. Tu pourras en définir un nouveau depuis Modifier.</small></section>}
    <section className="platform-stats"><article><span>Restaurants</span><strong>{overview?.restaurants.length ?? '—'}</strong></article><article><span>Licences actives</span><strong>{overview?.restaurants.filter((restaurant) => expiryLabel(restaurant) === 'Actif').length ?? '—'}</strong></article><article><span>Offres</span><strong>{overview?.plans.length ?? '—'}</strong></article></section>
    <div className="platform-columns">
      <section className="panel platform-panel"><div className="module-list-heading"><strong>Créer une offre</strong><span>Tarif indicatif · gestion manuelle</span></div><div className="platform-form"><label>Nom de l’offre<input value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="ex. Équipe 5" /></label><div className="platform-form-row"><label>Durée (jours)<input type="number" min="1" max="3650" value={planDays} onChange={(event) => setPlanDays(Number(event.target.value))} /></label><label>Prix (EUR)<input type="number" min="0" step="0.01" value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} /></label></div><button className="primary-button" disabled={busy || !planName.trim()} onClick={createPlan}>Créer l’offre</button></div><div className="platform-plan-list">{overview?.plans.map((plan) => <article key={plan.id}><strong>{plan.name}</strong><span>{plan.durationDays} jours · {plan.price.toFixed(2)} {plan.currency}</span></article>)}</div></section>
      <section className="panel platform-panel"><div className="module-list-heading"><strong>Créer un restaurant</strong><span>Identifiant code ou e-mail</span></div><div className="platform-form"><div className="platform-form-row"><label>Nom<input value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} placeholder="Le Mijoté" /></label><label>Identifiant<input type="text" inputMode="email" autoCapitalize="none" value={identifier} onChange={(event) => setIdentifier(event.target.value.toLowerCase())} placeholder="nom ou contact@restaurant.fr" /></label></div><label>Mot de passe restaurant<input type="password" autoComplete="new-password" value={restaurantPassword} onChange={(event) => setRestaurantPassword(event.target.value)} /></label><div className="platform-form-row"><label>Compte gérant<input autoCapitalize="none" value={managerUsername} onChange={(event) => setManagerUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="louise" /></label><label>Nom affiché<input value={managerName} onChange={(event) => setManagerName(event.target.value)} placeholder="Louise Martin" /></label></div><div className="platform-form-row"><label>PIN gérant<input type="password" inputMode="numeric" maxLength={12} value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, ''))} /></label><label>Offre<select value={selectedPlanId || activePlans[0]?.id || ''} onChange={(event) => setSelectedPlanId(event.target.value)}>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.durationDays} j</option>)}</select></label></div><div className={`platform-validation ${createIssues.length ? 'needs-input' : 'ready'}`} role="status"><strong>{createIssues.length ? 'À compléter pour créer le restaurant :' : 'Tout est prêt pour créer le restaurant.'}</strong>{createIssues.length > 0 && <ul>{createIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div><button className="primary-button" disabled={busy || createIssues.length > 0} onClick={createRestaurant}>{busy ? 'Création...' : 'Créer et attribuer la licence'}</button></div></section>
    </div>
    <section className="panel platform-restaurants"><div className="module-list-heading"><strong>Parc restaurants</strong><span>{overview?.restaurants.length || 0}</span></div>{overview?.restaurants.map((restaurant) => <article className="platform-restaurant-row" key={restaurant.id}><div className="platform-restaurant-identity"><strong>{restaurant.name}</strong><small>Identifiant : <code>{restaurant.identifier}</code> · {restaurant.planName || 'Aucune offre'} · échéance {restaurant.expiresAt ? new Date(restaurant.expiresAt).toLocaleDateString('fr-FR') : 'sans date'}</small></div><span className={`status-pill ${expiryLabel(restaurant) !== 'Actif' ? 'orange-pill' : ''}`}>{!restaurant.accessConfigured ? 'À configurer' : expiryLabel(restaurant)}</span><select aria-label={`Offre pour ${restaurant.name}`} value={rowPlans[restaurant.id] || restaurant.planId || activePlans[0]?.id || ''} onChange={(event) => setRowPlans((current) => ({ ...current, [restaurant.id]: event.target.value }))}>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><button className="action-button" onClick={() => openEdit(restaurant)}>{restaurant.accessConfigured ? 'Modifier' : 'Configurer l’accès'}</button><button className="action-button" disabled={busy || !restaurant.accessConfigured} onClick={() => assignPlan(restaurant, 'active')}>Renouveler</button><button className="text-button" disabled={busy || !restaurant.accessConfigured} onClick={() => assignPlan(restaurant, 'suspended')}>Suspendre</button></article>)}</section>
    {editing && <div className="modal-backdrop" onClick={() => setEditing(null)}><section className="modal platform-edit-modal" onClick={(event) => event.stopPropagation()}><header className="modal-heading"><div><p className="eyebrow">ACCÈS RESTAURANT</p><h2>{editing.accessConfigured ? 'Modifier le restaurant' : 'Configurer l’accès'}</h2></div><button onClick={() => setEditing(null)} aria-label="Fermer">×</button></header><p className="platform-password-note">Le mot de passe précédent est haché et ne peut pas être relu. Saisis-en un nouveau pour le remplacer.</p><div className="platform-form"><label>Nom<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label>Identifiant restaurant<input type="text" inputMode="email" autoCapitalize="none" value={editIdentifier} onChange={(event) => setEditIdentifier(event.target.value.toLowerCase())} /></label><label>{editing.accessConfigured ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe restaurant (8 caractères minimum)'}<input type="password" autoComplete="new-password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} /></label>{!editing.accessConfigured && <><div className="platform-form-row"><label>Compte gérant<input value={firstManagerUsername} onChange={(event) => setFirstManagerUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} /></label><label>Nom affiché<input value={firstManagerName} onChange={(event) => setFirstManagerName(event.target.value)} /></label></div><div className="platform-form-row"><label>PIN gérant<input type="password" inputMode="numeric" maxLength={12} value={firstManagerPin} onChange={(event) => setFirstManagerPin(event.target.value.replace(/\D/g, ''))} /></label><label>Offre<select value={editPlanId} onChange={(event) => setEditPlanId(event.target.value)}>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.durationDays} j</option>)}</select></label></div></>}{error && <p className="login-error">{error}</p>}<button className="primary-button" disabled={busy || !validRestaurantIdentifier(editIdentifier) || editName.trim().length < 2 || (editing.accessConfigured && !!editPassword && editPassword.length < 8)} onClick={saveEdit}>{busy ? 'Enregistrement...' : editing.accessConfigured ? 'Enregistrer les changements' : 'Configurer l’accès et attribuer'}</button></div></section></div>}
  </div>
}