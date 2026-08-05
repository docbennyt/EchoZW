insert into institutions (name, slug)
values ('aiDo Demo University', 'aido-demo-university')
on conflict (slug) do nothing;
