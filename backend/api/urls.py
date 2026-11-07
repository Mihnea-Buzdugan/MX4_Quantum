from django.urls import path
from . import views

urlpatterns = [
    path('user_login/', views.LoginView.as_view(), name='login'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('signup/', views.SignUpView.as_view(), name='signup'),
    path('google_login/', views.GoogleLoginView.as_view(), name='google_login'),
    path('user/', views.UserView.as_view(), name='user'),
    path("railway/plan", views.railway_plan, name="railway-plan"),
    path("plans/", views.plan_list),
    path("plans/<int:pk>/", views.plan_detail),
    path("batches/", views.batch_list),
    path("batches/<int:pk>/", views.batch_detail),
]