const { data, error } = await supabase
  .from("requests")
  .select(`
    id,
    request_type,
    category,
    description,
    location,
    urgency,
    status,
    created_at
  `)
  .eq("status", "open")
  .eq("request_type", "resource")
  .order("created_at", {
    ascending: false
  });
